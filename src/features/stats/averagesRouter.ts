import { ButtonInteraction, MessageFlags, StringSelectMenuInteraction } from 'discord.js';
import { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { averagesDataCache, type AveragesCacheData } from '../../cache/averagesDataCache.js';
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
