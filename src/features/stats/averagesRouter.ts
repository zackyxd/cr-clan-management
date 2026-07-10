import { ButtonInteraction, EmbedBuilder, MessageFlags, StringSelectMenuInteraction } from 'discord.js';
import { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { averagesDataCache, type AveragesCacheData } from '../../cache/averagesDataCache.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { getSpreadsheetId } from './statsUtil.js';
import {
  applyAverageRoleChanges,
  buildPreviewEmbeds,
  computeAverageRoleChanges,
  sendAverageRoleAnnouncements,
} from './averageRoles.js';
import {
  buildAccountSelectRow,
  buildSummaryEmbed,
  buildWeeklyEmbed,
  buildWeeksButtonRow,
  DEFAULT_WEEKS_SHOWN,
} from './averagesEmbeds.js';

/**
 * Averages Feature Interaction Router
 * Handles the account select menu and weeks/summary buttons for /average.
 */
export class AveragesInteractionRouter {
  static async handleSelectMenu(interaction: StringSelectMenuInteraction, parsed: ParsedCustomId): Promise<void> {
    if (parsed.action !== 'average_select') return;

    if (!(await this.checkOwner(interaction, parsed))) return;

    const cacheData = this.getCacheData(interaction);
    if (!cacheData) {
      await interaction.reply({
        content: 'Session expired. Please run the command again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const entry = cacheData.entries.get(interaction.values[0]);
    if (!entry) {
      await interaction.reply({ content: 'Could not find that account.', flags: MessageFlags.Ephemeral });
      return;
    }

    const guildId = interaction.guildId!;
    const ownerId = parsed.ownerId!;
    const weeklyEmbed = buildWeeklyEmbed(entry, DEFAULT_WEEKS_SHOWN, cacheData.avatarURL);
    const selectRow = buildAccountSelectRow(guildId, ownerId, [...cacheData.entries.values()]);
    const weeksRow = buildWeeksButtonRow(guildId, ownerId, entry, DEFAULT_WEEKS_SHOWN);

    await interaction.update({ embeds: [weeklyEmbed], components: selectRow ? [selectRow, weeksRow] : [weeksRow] });
  }

  static async handleButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, extra } = parsed;

    if (action === 'averageRoles_send') {
      return this.handleAverageRolesSend(interaction, parsed);
    }

    if (!(await this.checkOwner(interaction, parsed))) return;

    const cacheData = this.getCacheData(interaction);
    if (!cacheData) {
      await interaction.reply({
        content: 'Session expired. Please run the command again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId!;
    const ownerId = parsed.ownerId!;

    if (action === 'average_weeks') {
      const [key, weeksCountStr] = extra;
      const entry = cacheData.entries.get(key);
      if (!entry) {
        await interaction.reply({ content: 'Could not find that account.', flags: MessageFlags.Ephemeral });
        return;
      }

      const weeksShown = Number(weeksCountStr) || DEFAULT_WEEKS_SHOWN;
      const weeklyEmbed = buildWeeklyEmbed(entry, weeksShown, cacheData.avatarURL);
      const selectRow = buildAccountSelectRow(guildId, ownerId, [...cacheData.entries.values()]);
      const weeksRow = buildWeeksButtonRow(guildId, ownerId, entry, weeksShown);

      await interaction.update({ embeds: [weeklyEmbed], components: selectRow ? [selectRow, weeksRow] : [weeksRow] });
    } else if (action === 'average_summary') {
      const summaryEmbed = buildSummaryEmbed(cacheData.displayName, cacheData.avatarURL, [...cacheData.entries.values()]);
      const selectRow = buildAccountSelectRow(guildId, ownerId, [...cacheData.entries.values()]);

      await interaction.update({ embeds: [summaryEmbed], components: selectRow ? [selectRow] : [] });
    }
  }

  /** Messages currently being applied — blocks a rapid double-click from applying twice. */
  private static applyingMessages = new Set<string>();

  /**
   * "Apply Roles & Send" from /stats roles: re-read the sheet at click
   * time (no cached computation — sheets and roles may have changed since the
   * preview), give the roles, then post the announcements.
   */
  private static async handleAverageRolesSend(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    if (!(await this.checkOwner(interaction, parsed))) return;

    const allowed = await checkPerms(interaction, 'button', 'higher', { hideNoPerms: true });
    if (!allowed) return;

    const guild = interaction.guild;
    if (!guild) return;

    if (this.applyingMessages.has(interaction.message.id)) {
      await interaction.followUp({ content: 'Already applying — hang on.', flags: MessageFlags.Ephemeral });
      return;
    }
    this.applyingMessages.add(interaction.message.id);

    try {
      // Remove the button right away so it can't be clicked again.
      await interaction.editReply({ components: [] });

      const spreadsheetId = await getSpreadsheetId(guild.id);
      if (!spreadsheetId) {
        await interaction.followUp({ content: '❌ Spreadsheet ID not configured.', flags: MessageFlags.Ephemeral });
        return;
      }

      const { error, computation } = await computeAverageRoleChanges(guild, spreadsheetId);
      if (error || !computation) {
        await interaction.followUp({
          content: `❌ ${error ?? 'Could not compute average roles.'}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (computation.totalChanges === 0) {
        await interaction.followUp({
          content: '✅ Nothing to apply — everyone already holds their highest earned role.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Show what was actually applied (freshly recomputed, so it can differ from the preview).
      await interaction.editReply({ embeds: buildPreviewEmbeds(computation), components: [] });

      const applyResult = await applyAverageRoleChanges(guild, computation);
      const sendResult = await sendAverageRoleAnnouncements(guild, computation);

      const lines = [
        `✅ Updated roles for **${applyResult.applied}** member(s).`,
        `📨 Sent **${sendResult.sent}** announcement(s).`,
      ];
      const failures = [...applyResult.failures, ...sendResult.failures];
      if (failures.length > 0) {
        lines.push('', '**Failures:**', ...failures.slice(0, 15));
        if (failures.length > 15) lines.push(`…and ${failures.length - 15} more.`);
      }

      const summary = new EmbedBuilder()
        .setTitle('Average Roles — Applied')
        .setDescription(lines.join('\n'))
        .setColor(failures.length > 0 ? EmbedColor.WARNING : EmbedColor.SUCCESS);

      await interaction.followUp({ embeds: [summary], flags: MessageFlags.Ephemeral });
    } finally {
      this.applyingMessages.delete(interaction.message.id);
    }
  }

  /** Only the person who ran /average can drive its select menu/buttons. */
  private static async checkOwner(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    parsed: ParsedCustomId,
  ): Promise<boolean> {
    if (parsed.ownerId && parsed.ownerId !== interaction.user.id) {
      await interaction.reply({
        content: 'Only the person who ran this command can interact with these results.',
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }
    return true;
  }

  private static getCacheData(interaction: ButtonInteraction | StringSelectMenuInteraction): AveragesCacheData | undefined {
    const interactionId = interaction.message.interactionMetadata?.id;
    return interactionId ? averagesDataCache.get(interactionId) : undefined;
  }
}
