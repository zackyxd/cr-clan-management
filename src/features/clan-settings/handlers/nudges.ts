/**
 * Race Nudge Settings Handler
 *
 * Handles all nudge-related settings:
 * 1. Toggle nudge enabled/disabled
 * 2. Grouped modal (enable, channel, schedule, custom message)
 */

import {
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  MessageFlags,
  CheckboxBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
} from 'discord.js';
import { pool } from '../../../db.js';
import { makeCustomId, parseCustomId } from '../../../utils/customId.js';
import { checkPerms } from '../../../utils/checkPermissions.js';
import type { ClanSettingsData } from '../types.js';
import { clanSettingsService } from '../service.js';
import { updateClanSettingsView } from './helpers.js';
import logger from '../../../logger.js';
import { getNudgeMessage } from '../../race-tracking/nudgeHelper.js';

export class NudgesHandler {
  /**
   * Toggle nudge enabled/disabled
   */
  static async toggleNudgeEnabled(interaction: ButtonInteraction, settingsData: ClanSettingsData): Promise<void> {
    const { guildId, clantag, clanName } = settingsData;

    // Defer to allow time for DB operations
    await interaction.deferReply({ ephemeral: true });

    const result = await clanSettingsService.toggleNudgeEnabled(
      interaction.client,
      guildId,
      clantag,
      interaction.user.id,
    );

    if (!result.success) {
      await interaction.editReply({
        content: result.error || 'Failed to toggle nudge setting',
      });
      return;
    }

    // Update the main settings view (updates original message)
    try {
      await updateClanSettingsView(interaction, guildId, clantag, clanName);
    } catch (error) {
      logger.error('[NudgesHandler] Failed to update settings view:', error);
      await interaction.editReply({
        content: '⚠️ Setting updated but failed to refresh display. Please reopen clan settings.',
      });
      return;
    }

    // Confirm success in ephemeral reply
    await interaction.editReply({
      content: '✅ Nudge setting updated successfully',
    });
  }

  /**
   * Show the grouped nudge settings modal
   *
   * @param interaction - Button interaction from Discord
   * @param settingsData - Cached settings data (from cache key)
   */
  static async showModal(interaction: ButtonInteraction, settingsData: ClanSettingsData): Promise<void> {
    const { guildId, clantag } = settingsData;

    try {
      // Get current settings from database
      const currentResult = await pool.query(
        `SELECT clan_name, nudge_enabled, race_nudge_channel_id, race_nudge_start_hour, race_nudge_start_minute, 
                race_nudge_interval_hours , race_custom_nudge_message
         FROM clans WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );

      const row = currentResult.rows[0];
      const nudgeEnabled = row?.nudge_enabled ?? false;
      const nudgeChannel = row?.race_nudge_channel_id || '';
      const startHour = row?.race_nudge_start_hour !== null ? String(row.race_nudge_start_hour) : '';
      const intervalHours = row?.race_nudge_interval_hours !== null ? String(row.race_nudge_interval_hours) : '';
      const customMessage = await getNudgeMessage(
        guildId,
        clantag,
        row.clan_name,
        undefined,
        row.race_custom_nudge_message,
      );

      const modal = new ModalBuilder()
        .setTitle('Race Nudge Settings')
        .setCustomId(makeCustomId('m', 'clanSettings_nudge_settings', guildId, { extra: [clantag] }))
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Enable Nudges')
            .setDescription('Check to enable automatic nudges.')
            .setCheckboxComponent(new CheckboxBuilder().setCustomId('nudge_enabled').setDefault(nudgeEnabled)),
          new LabelBuilder()
            .setLabel('Nudge Channel')
            .setDescription('Select the channel where nudges will be sent')
            .setChannelSelectMenuComponent(
              new ChannelSelectMenuBuilder()
                .setCustomId('channel_id')
                .setChannelTypes(ChannelType.GuildText)
                .setDefaultChannels(nudgeChannel ? [nudgeChannel] : [])
                .setMaxValues(1)
                .setRequired(true),
            ),
          new LabelBuilder()
            .setLabel('Nudge Custom Message')
            .setDescription('Change the default nudge message (leave blank for default). Resets daily.')
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('nudge_custom_message')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setPlaceholder('Leave blank for default')
                .setMaxLength(200)
                .setValue(customMessage ?? ''),
            ),
          new LabelBuilder()
            .setLabel('Schedule: Start Hour (UTC, 0-23)')
            .setDescription('Hour when nudges start. Leave blank to keep current')
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('start_hour')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMinLength(1)
                .setMaxLength(2)
                .setPlaceholder('e.g., 14')
                .setValue(startHour),
            ),
          new LabelBuilder()
            .setLabel('Schedule: Interval (Hours)')
            .setDescription('Hours between nudges (e.g., 2 or 1.5). Leave blank to keep current')
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('interval_hours')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMinLength(1)
                .setMaxLength(4)
                .setPlaceholder('e.g., 2')
                .setValue(intervalHours),
            ),
        );

      await interaction.showModal(modal);
    } catch (error) {
      logger.error('[Nudges] Error showing modal:', error);
      await interaction.reply({
        content: '❌ Failed to show nudge settings modal.',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle grouped nudge settings modal submission
   *
   * @param interaction - Modal submission from Discord
   */
  static async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCustomId(interaction.customId);
    const { guildId, extra } = parsed;
    const clantag = extra[0];

    if (!guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    if (!clantag) {
      await interaction.reply({
        content: 'Missing clan tag. Please try again.',
        ephemeral: true,
      });
      return;
    }

    try {
      // Get values from modal
      const nudgeEnabled = interaction.fields.getCheckbox('nudge_enabled');
      const channelIds = interaction.fields.getSelectedChannels('channel_id');
      const channelId = channelIds?.first()?.id || '';
      const startHourStr = interaction.fields.getTextInputValue('start_hour').trim();
      const intervalHoursStr = interaction.fields.getTextInputValue('interval_hours').trim();
      const customMessage = interaction.fields.getTextInputValue('nudge_custom_message').trim();

      // Check permissions (defers interaction if hideNoPerms is true)
      const allowed = await checkPerms(interaction, guildId, 'modal', 'either', { hideNoPerms: true });
      if (!allowed) return;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Get old values and clan name for audit log
        const oldResult = await client.query(
          `SELECT nudge_enabled, race_nudge_channel_id, race_nudge_start_hour, race_nudge_interval_hours, clan_name, race_custom_nudge_message
           FROM clans WHERE guild_id = $1 AND clantag = $2`,
          [guildId, clantag],
        );
        const oldValues = oldResult.rows[0];
        const clanName = oldValues?.clan_name;

        // Track what changed for the log
        const changes: string[] = [];

        // Update nudge enabled
        await client.query(`UPDATE clans SET nudge_enabled = $1 WHERE guild_id = $2 AND clantag = $3`, [
          nudgeEnabled,
          guildId,
          clantag,
        ]);
        if (oldValues.nudge_enabled !== nudgeEnabled) {
          changes.push(
            `Nudge Enabled: ${oldValues.nudge_enabled ? 'Enabled' : 'Disabled'} → ${nudgeEnabled ? 'Enabled' : 'Disabled'}`,
          );
        }

        // Update custom message
        const normalizedCustomMessage = customMessage || null;
        const oldCustomMessage = oldValues.race_custom_nudge_message || null;

        if (oldCustomMessage !== normalizedCustomMessage) {
          await client.query(`UPDATE clans SET race_custom_nudge_message = $1 WHERE guild_id = $2 AND clantag = $3`, [
            normalizedCustomMessage,
            guildId,
            clantag,
          ]);

          const oldMessageDisplay = oldCustomMessage ? `"${oldCustomMessage}"` : 'Default';
          const newMessageDisplay = normalizedCustomMessage ? `"${normalizedCustomMessage}"` : 'Default';
          changes.push(`Custom Message: ${oldMessageDisplay} → ${newMessageDisplay}`);
        }

        // Update channel if provided
        if (channelId && channelId !== oldValues.race_nudge_channel_id) {
          await client.query(`UPDATE clans SET race_nudge_channel_id = $1 WHERE guild_id = $2 AND clantag = $3`, [
            channelId,
            guildId,
            clantag,
          ]);
          changes.push(
            `Nudge Channel: ${oldValues.race_nudge_channel_id ? `<#${oldValues.race_nudge_channel_id}>` : 'None'} → <#${channelId}>`,
          );
        }

        // Update schedule if both fields provided
        if (startHourStr && intervalHoursStr) {
          const startHour = parseInt(startHourStr);
          const intervalHours = parseFloat(intervalHoursStr);

          if (isNaN(startHour) || startHour < 0 || startHour > 23) {
            await client.query('ROLLBACK');
            await interaction.followUp({
              content: '❌ Start hour must be between 0 and 23.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          if (isNaN(intervalHours) || intervalHours <= 0 || intervalHours > 12) {
            await client.query('ROLLBACK');
            await interaction.followUp({
              content: '❌ Interval must be between 0 and 12 hours.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          await client.query(
            `UPDATE clans 
             SET race_nudge_start_hour = $1, 
                 race_nudge_start_minute = $2, 
                 race_nudge_interval_hours = $3 
             WHERE guild_id = $4 AND clantag = $5`,
            [startHour, 0, intervalHours, guildId, clantag],
          );

          // Track schedule change
          const now = new Date();
          const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

          const oldSchedule =
            oldValues.race_nudge_start_hour !== null && oldValues.race_nudge_interval_hours !== null
              ? (() => {
                  const oldTime = new Date(todayUTC);
                  oldTime.setUTCHours(oldValues.race_nudge_start_hour, 0, 0, 0);
                  const oldUnix = Math.floor(oldTime.getTime() / 1000);
                  return `<t:${oldUnix}:t> every ${oldValues.race_nudge_interval_hours}h`;
                })()
              : 'Not set';

          const newTime = new Date(todayUTC);
          newTime.setUTCHours(startHour, 0, 0, 0);
          const newUnix = Math.floor(newTime.getTime() / 1000);
          const newSchedule = `<t:${newUnix}:t> every ${intervalHours}h`;

          if (oldSchedule !== newSchedule) {
            changes.push(`Schedule: ${oldSchedule} → ${newSchedule}`);
          }
        }

        await client.query('COMMIT');

        // Send audit log if any changes were made
        if (changes.length > 0) {
          clanSettingsService
            .sendLog(
              interaction.client,
              guildId,
              `⏰ Nudge Settings Changed`,
              `**Clan:** ${clanName}\n${changes.join('\n')}\n**Changed by:** <@${interaction.user.id}>`,
            )
            .catch((err) => logger.error('Error sending nudge settings update log:', err));
        }

        await interaction.followUp({
          content: '✅ Nudge settings updated successfully!',
          flags: MessageFlags.Ephemeral,
        });

        // Update the original clan settings message
        const messageId = interaction.message?.id;
        if (messageId && interaction.channel) {
          try {
            const message = await interaction.channel.messages.fetch(messageId);
            const { embed, components: newButtonRows } = await (
              await import('../config.js')
            ).buildClanSettingsView(guildId, clanName, clantag, interaction.user.id);
            const selectMenuRowBuilder = (await import('../config.js')).getSelectMenuRowBuilder(message.components);

            await message.edit({
              embeds: [embed],
              components: selectMenuRowBuilder ? [...newButtonRows, selectMenuRowBuilder] : newButtonRows,
            });
            logger.debug(`[Nudges] Updated clan settings message for ${clanName}`);
          } catch (error) {
            logger.warn('[Nudges] Could not update clan settings message:', error);
            // Non-critical - user can refresh manually
          }
        }

        logger.info(`[Nudges] ${interaction.user.tag} updated nudge settings for ${clantag} in guild ${guildId}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      logger.error('[Nudges] Error updating nudge settings:', error);

      // Use followUp if already deferred, reply otherwise
      const response = {
        content: '❌ Failed to update nudge settings.',
        flags: MessageFlags.Ephemeral,
      };

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(response).catch(() => {});
      } else {
        await interaction.reply(response).catch(() => {});
      }
    }
  }
}
