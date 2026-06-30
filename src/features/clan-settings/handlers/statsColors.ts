import {
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  MessageFlags,
} from 'discord.js';
import { makeCustomId, parseCustomId } from '../../../utils/customId.js';
import { checkPerms } from '../../../utils/checkPermissions.js';
import { buildClanSettingsView, getSelectMenuRowBuilder } from '../config.js';
import { clanSettingsService } from '../service.js';
import type { ClanSettingsData } from '../types.js';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import { normalizeHexColor } from '../../stats/clanHeaderColors.js';

export class StatsColorsHandler {
  static async showModal(interaction: ButtonInteraction, settingsData: ClanSettingsData): Promise<void> {
    const { guildId, clantag, clanName } = settingsData;

    const result = await pool.query(
      `SELECT header_bg_hex, header_text_hex FROM clans WHERE guild_id = $1 AND clantag = $2`,
      [guildId, clantag],
    );

    if (result.rows.length === 0) {
      await interaction.reply({ content: '❌ Clan not found.', flags: MessageFlags.Ephemeral });
      return;
    }

    const current = result.rows[0];
    const modal = new ModalBuilder()
      .setTitle(`${clanName} Stats Colors`)
      .setCustomId(makeCustomId('m', 'clanSettings_stats_colors', guildId, { extra: [clantag] }))
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Header Background Hex')
          .setDescription('Example: #457FB5. Leave blank to use auto palette.')
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId('header_bg_hex')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(7)
              .setValue(current.header_bg_hex || ''),
          ),
        new LabelBuilder()
          .setLabel('Header Text Hex')
          .setDescription('Example: #FFFFFF. Leave blank to auto-pick contrast.')
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId('header_text_hex')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(7)
              .setValue(current.header_text_hex || ''),
          ),
      );

    await interaction.showModal(modal);
  }

  static async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCustomId(interaction.customId);
    const { guildId, extra } = parsed;
    const clantag = extra[0];

    if (!clantag) {
      await interaction.reply({ content: 'Missing clan tag. Please try again.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allowed = await checkPerms(interaction, 'modal', 'either', { hideNoPerms: true });
    if (!allowed) return;

    const rawBg = interaction.fields.getTextInputValue('header_bg_hex')?.trim() || '';
    const rawText = interaction.fields.getTextInputValue('header_text_hex')?.trim() || '';
    const headerBgHex = normalizeHexColor(rawBg);
    const headerTextHex = normalizeHexColor(rawText);

    if (rawBg && !headerBgHex) {
      await interaction.followUp({
        content: '❌ Header background must be a valid hex color like #457FB5.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (rawText && !headerTextHex) {
      await interaction.followUp({
        content: '❌ Header text must be a valid hex color like #FFFFFF.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!headerBgHex && headerTextHex) {
      await interaction.followUp({
        content: '❌ Set a header background color before setting a custom text color.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const oldValues = await pool.query(
        `SELECT clan_name, header_bg_hex, header_text_hex FROM clans WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );

      if (oldValues.rows.length === 0) {
        await interaction.followUp({ content: '❌ Clan not found.', flags: MessageFlags.Ephemeral });
        return;
      }

      const old = oldValues.rows[0];
      const changes: string[] = [];

      if ((old.header_bg_hex || null) !== headerBgHex) {
        changes.push(`**Header BG:** ${old.header_bg_hex || 'Auto'} → ${headerBgHex || 'Auto'}`);
      }
      if ((old.header_text_hex || null) !== headerTextHex) {
        changes.push(`**Header Text:** ${old.header_text_hex || 'Auto'} → ${headerTextHex || 'Auto'}`);
      }

      if (changes.length === 0) {
        await interaction.followUp({ content: 'ℹ️ No changes detected.', flags: MessageFlags.Ephemeral });
        return;
      }

      await pool.query(
        `UPDATE clans
            SET header_bg_hex = $1,
                header_text_hex = $2
          WHERE guild_id = $3 AND clantag = $4`,
        [headerBgHex, headerTextHex, guildId, clantag],
      );

      await clanSettingsService.sendLog(
        interaction.client,
        guildId,
        '🎨 Clan Stats Colors Updated',
        `**Clan:** ${old.clan_name}\n${changes.join('\n')}\n**Changed by:** <@${interaction.user.id}>`,
      );

      if (interaction.message) {
        try {
          const { embed, components: newButtonRows } = await buildClanSettingsView(
            guildId,
            old.clan_name,
            clantag,
            interaction.user.id,
          );
          const selectMenuRowBuilder = getSelectMenuRowBuilder(interaction.message.components);

          await interaction.editReply({
            embeds: [embed],
            components: selectMenuRowBuilder ? [...newButtonRows, selectMenuRowBuilder] : newButtonRows,
          });
        } catch (error) {
          logger.warn('[StatsColors] Could not update clan settings message:', error);
        }
      }

      await interaction.followUp({
        content: '✅ Stats header colors updated successfully!',
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.error('[StatsColors] Error handling modal:', error);
      await interaction.followUp({
        content: '❌ Failed to update stats header colors.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
