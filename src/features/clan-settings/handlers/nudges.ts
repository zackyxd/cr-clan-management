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
  RadioGroupOptionBuilder,
  RadioGroupBuilder,
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
        `SELECT clan_name, nudge_method, race_nudge_channel_id, race_nudge_start_hour, race_nudge_start_minute, 
                race_nudge_interval_hours, race_nudge_hours_before_array, race_custom_nudge_message
         FROM clans WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );

      const row = currentResult.rows[0];
      const nudgeMethod = row?.nudge_method || 'disabled';
      const nudgeChannel = row?.race_nudge_channel_id || '';
      const startHour = row?.race_nudge_start_hour !== null ? String(row.race_nudge_start_hour) : '';
      const startMinute = row?.race_nudge_start_minute !== null ? String(row.race_nudge_start_minute) : '0';
      const intervalHours = row?.race_nudge_interval_hours !== null ? String(row.race_nudge_interval_hours) : '';
      const hoursBeforeArray = row?.race_nudge_hours_before_array || [];
      const hoursBeforeStr = hoursBeforeArray.length > 0 ? hoursBeforeArray.join(',') : '';
      const customMessage = row?.race_custom_nudge_message || '';

      // Build interval method value (HH:MM,interval)
      const intervalMethodValue =
        startHour && intervalHours ? `${startHour}:${startMinute.padStart(2, '0')},${intervalHours}` : '';
      console.log('intervalMethodValue:', intervalMethodValue, startHour, startMinute, intervalHours);
      const modal = new ModalBuilder()
        .setTitle('Race Nudge Settings')
        .setCustomId(makeCustomId('m', 'clanSettings_nudge_settings', guildId, { extra: [clantag] }))
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Nudge Method')
            .setDescription('Choose how nudges should work')
            .setRadioGroupComponent(
              new RadioGroupBuilder()
                .setOptions([
                  { label: 'Disabled', value: 'disabled', default: nudgeMethod === 'disabled' },
                  { label: 'Interval Method', value: 'interval', default: nudgeMethod === 'interval' },
                  {
                    label: 'Hours Before War End',
                    value: 'hours_before_end',
                    default: nudgeMethod === 'hours_before_end',
                  },
                ])
                .setCustomId('nudge_method'),
            ),
          new LabelBuilder()
            .setLabel('Nudge Channel')
            .setDescription('Select the channel where nudges will be sent')
            .setChannelSelectMenuComponent(
              new ChannelSelectMenuBuilder()
                .setCustomId('channel_id')
                .setChannelTypes(ChannelType.GuildText)
                .setDefaultChannels(nudgeChannel ? [nudgeChannel] : [])
                .setMaxValues(1)
                .setRequired(false),
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
                .setValue(customMessage),
            ),
          new LabelBuilder()
            .setLabel('Interval Method: HH:MM, interval')
            .setDescription('Start time and interval. E.g., "14:30, 2" = 2:30pm every 2 hours')
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('interval_method')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setPlaceholder('e.g., 14:30, 2')
                .setMaxLength(20)
                .setValue(intervalMethodValue),
            ),
          new LabelBuilder()
            .setLabel('Hours Before End: comma separated')
            .setDescription('Nudge X hours before war end (9am UTC). E.g., "2,4,6,10"')
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('hours_before_end')
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setPlaceholder('e.g., 2,4,6,10')
                .setMaxLength(50)
                .setValue(hoursBeforeStr),
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
      const nudgeMethod = interaction.fields.getRadioGroup('nudge_method');
      const channelIds = interaction.fields.getSelectedChannels('channel_id');
      const channelId = channelIds?.first()?.id || null;
      const intervalMethodStr = interaction.fields.getTextInputValue('interval_method').trim();
      const hoursBeforeEndStr = interaction.fields.getTextInputValue('hours_before_end').trim();
      const customMessage = interaction.fields.getTextInputValue('nudge_custom_message').trim();

      // Check permissions (defers interaction if hideNoPerms is true)
      const allowed = await checkPerms(interaction, guildId, 'modal', 'either', { hideNoPerms: true });
      if (!allowed) return;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Get old values and clan name for audit log
        const oldResult = await client.query(
          `SELECT nudge_method, race_nudge_channel_id, race_nudge_start_hour, race_nudge_start_minute, 
                  race_nudge_interval_hours, race_nudge_hours_before_array, clan_name, race_custom_nudge_message
           FROM clans WHERE guild_id = $1 AND clantag = $2`,
          [guildId, clantag],
        );
        const oldValues = oldResult.rows[0];
        const clanName = oldValues?.clan_name;

        // Track what changed for the log
        const changes: string[] = [];

        // Update nudge method
        await client.query(`UPDATE clans SET nudge_method = $1 WHERE guild_id = $2 AND clantag = $3`, [
          nudgeMethod,
          guildId,
          clantag,
        ]);
        if (oldValues.nudge_method !== nudgeMethod) {
          const methodNames = { disabled: 'Disabled', interval: 'Interval', hours_before_end: 'Hours Before End' };
          changes.push(
            `Nudge Method: ${methodNames[oldValues.nudge_method] || 'Unknown'} → ${methodNames[nudgeMethod] || 'Unknown'}`,
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
        if (channelId !== oldValues.race_nudge_channel_id) {
          await client.query(`UPDATE clans SET race_nudge_channel_id = $1 WHERE guild_id = $2 AND clantag = $3`, [
            channelId,
            guildId,
            clantag,
          ]);
          if (channelId) {
            changes.push(
              `Nudge Channel: ${oldValues.race_nudge_channel_id ? `<#${oldValues.race_nudge_channel_id}>` : 'None'} → <#${channelId}>`,
            );
          }
        }

        // Process interval method data if provided (regardless of selected method)
        if (intervalMethodStr) {
          // Parse "HH:MM,interval" format
          const parts = intervalMethodStr.split(',').map((p) => p.trim());
          if (parts.length !== 2) {
            await client.query('ROLLBACK');
            await interaction.followUp({
              content: '❌ Interval method format must be "HH:MM,interval" (e.g., "14:30,2")',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const [timeStr, intervalStr] = parts;
          const timeParts = timeStr.split(':');
          if (timeParts.length !== 2) {
            await client.query('ROLLBACK');
            await interaction.followUp({
              content: '❌ Time format must be "HH:MM" (e.g., "14:30")',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const startHour = parseInt(timeParts[0]);
          const startMinute = parseInt(timeParts[1]);
          const intervalHours = parseFloat(intervalStr);

          if (isNaN(startHour) || startHour < 0 || startHour > 23) {
            await client.query('ROLLBACK');
            await interaction.followUp({
              content: '❌ Start hour must be between 0 and 23.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          if (isNaN(startMinute) || startMinute < 0 || startMinute > 59) {
            await client.query('ROLLBACK');
            await interaction.followUp({
              content: '❌ Start minute must be between 0 and 59.',
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
            [startHour, startMinute, intervalHours, guildId, clantag],
          );

          // Track schedule change
          const now = new Date();
          const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

          const oldSchedule =
            oldValues.race_nudge_start_hour !== null && oldValues.race_nudge_interval_hours !== null
              ? (() => {
                  const oldTime = new Date(todayUTC);
                  oldTime.setUTCHours(oldValues.race_nudge_start_hour, oldValues.race_nudge_start_minute || 0, 0, 0);
                  const oldUnix = Math.floor(oldTime.getTime() / 1000);
                  return `<t:${oldUnix}:t> every ${oldValues.race_nudge_interval_hours}h`;
                })()
              : 'Not set';

          const newTime = new Date(todayUTC);
          newTime.setUTCHours(startHour, startMinute, 0, 0);
          const newUnix = Math.floor(newTime.getTime() / 1000);
          const newSchedule = `<t:${newUnix}:t> every ${intervalHours}h`;

          if (oldSchedule !== newSchedule) {
            changes.push(`Interval Schedule: ${oldSchedule} → ${newSchedule}`);
          }
        }

        // Process hours before end data if provided (regardless of selected method)  
        if (hoursBeforeEndStr) {
          // Parse comma-separated hours
          const hoursArray = hoursBeforeEndStr
            .split(',')
            .map((h) => h.trim())
            .filter((h) => h.length > 0)
            .map((h) => parseFloat(h));

          if (hoursArray.length === 0) {
            await client.query('ROLLBACK');
            await interaction.followUp({
              content: '❌ Please provide at least one hour value (e.g., "2,4,6,10")',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          // Validate all values
          for (const hour of hoursArray) {
            if (isNaN(hour) || hour <= 0 || hour > 24) {
              await client.query('ROLLBACK');
              await interaction.followUp({
                content: '❌ All hour values must be between 0 and 24.',
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
          }

          await client.query(
            `UPDATE clans 
             SET race_nudge_hours_before_array = $1
             WHERE guild_id = $2 AND clantag = $3`,
            [hoursArray, guildId, clantag],
          );

          const oldHoursArray = oldValues.race_nudge_hours_before_array || [];
          const oldHoursStr = oldHoursArray.length > 0 ? oldHoursArray.join(',') : 'Not set';
          const newHoursStr = hoursArray.join(',');

          if (oldHoursStr !== newHoursStr) {
            changes.push(`Hours Before End: ${oldHoursStr} → ${newHoursStr}`);
          }
        }

        // Validation: Ensure selected method has required data
        if (nudgeMethod === 'interval') {
          const hasIntervalData = await client.query(
            `SELECT race_nudge_start_hour, race_nudge_interval_hours 
             FROM clans WHERE guild_id = $1 AND clantag = $2`,
            [guildId, clantag],
          );
          const data = hasIntervalData.rows[0];
          if (data.race_nudge_start_hour === null || data.race_nudge_interval_hours === null) {
            await client.query('ROLLBACK');
            await interaction.followUp({
              content: '❌ Please configure interval schedule in format "HH:MM,interval" (e.g., "14:30,2")',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
        } else if (nudgeMethod === 'hours_before_end') {
          const hasHoursData = await client.query(
            `SELECT race_nudge_hours_before_array 
             FROM clans WHERE guild_id = $1 AND clantag = $2`,
            [guildId, clantag],
          );
          const data = hasHoursData.rows[0];
          if (!data.race_nudge_hours_before_array || data.race_nudge_hours_before_array.length === 0) {
            await client.query('ROLLBACK');
            await interaction.followUp({
              content: '❌ Please configure hours before end (e.g., "2,4,6,10")',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
        } else if (nudgeMethod === 'disabled') {
          // No validation needed for disabled
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
