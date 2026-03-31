import { pool } from '../../db.js';
import { TextChannel, NewsChannel, Client, EmbedBuilder } from 'discord.js';
import { updateInviteMessage, repostInviteMessage } from '../clan-invites/messageManager.js';
import { getServerSettingsData } from '../../cache/serverSettingsDataCache.js';
import logger from '../../logger.js';
import type {
  ServerSettingsResponse,
  UpdateChannelSettingParams,
  UpdateTextSettingParams,
  ToggleSettingParams,
  SwapSettingParams,
} from './types.js';
import type { ServerSettingsData } from '../../cache/serverSettingsDataCache.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';
import { FeatureRegistry } from '../../config/featureRegistry.js';

/**
 * Core service class for managing server settings functionality
 * Handles all business logic for server configuration
 */
export class ServerSettingsService {
  /**
   * Get cached server settings data
   */
  getCachedSettingsData(cacheKey: string): ServerSettingsData | null {
    return getServerSettingsData(cacheKey) || null;
  }

  /**
   * Send audit log (fire-and-forget - does not block operation)
   * @param client Discord client
   * @param guildId Guild ID
   * @param title Log title
   * @param description Log description
   */
  async sendLog(client: Client, guildId: string, title: string, description: string): Promise<void> {
    try {
      const settingsResult = await pool.query(
        `SELECT logs_channel_id, send_logs FROM server_settings WHERE guild_id = $1`,
        [guildId],
      );

      const { logs_channel_id, send_logs } = settingsResult.rows[0] || {};

      if (!logs_channel_id || !send_logs) {
        return;
      }

      const channel = await client.channels.fetch(logs_channel_id);
      if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
        console.log(`Couldn't find valid logs channel for guild ${guildId} for server settings.`);
        return;
      }

      const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(BOTCOLOR);
      await channel.send({ embeds: [embed] });
    } catch (error) {
      logger.error('Error sending server settings log:', error);
    }
  }

  /**
   * Toggle a feature on/off
   */
  async toggleFeature(
    client: Client,
    guildId: string,
    featureName: string,
    userId: string,
  ): Promise<ServerSettingsResponse> {
    try {
      // Get current feature status
      const res = await pool.query(`SELECT is_enabled FROM guild_features WHERE guild_id = $1 AND feature_name = $2`, [
        guildId,
        featureName,
      ]);

      const isCurrentlyEnabled = res.rows[0]?.is_enabled ?? false;
      const newValue = !isCurrentlyEnabled;

      // Toggle the feature
      await pool.query(
        `INSERT INTO guild_features (guild_id, feature_name, is_enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, feature_name) DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
        [guildId, featureName, newValue],
      );

      logger.info(
        `Feature '${FeatureRegistry[featureName].displayName}' ${newValue ? 'enabled' : 'disabled'} for guild ${guildId}`,
      );

      // Fire-and-forget audit log (don't block the operation)
      this.sendLog(
        client,
        guildId,
        '🎯 Feature Toggled',
        `**Feature:** ${FeatureRegistry[featureName].displayName}\n**Status:** ${!newValue ? 'Enabled' : 'Disabled'}  → ${newValue ? 'Enabled' : 'Disabled'}\n**Changed by:** <@${userId}>`,
      ).catch((err) => logger.error('Failed to log feature toggle:', err));

      return {
        success: true,
        newValue,
      };
    } catch (error) {
      logger.error(`Error toggling feature ${featureName}:`, error);
      return {
        success: false,
        error: 'Failed to toggle feature',
      };
    }
  }

  /**
   * Toggle a generic setting
   */
  async toggleSetting(params: ToggleSettingParams): Promise<ServerSettingsResponse> {
    const { guildId, settingKey, tableName, featureName, client, userId } = params;

    try {
      // Handle special cases
      if (settingKey === 'show_inactive') {
        return await this.toggleShowInactive(guildId);
      }

      if (settingKey === 'pin_message') {
        return await this.togglePinMessage(guildId, client);
      }

      // Generic toggle for most settings
      const result = await pool.query(
        `UPDATE ${tableName}
         SET ${settingKey} = NOT ${settingKey}
         WHERE guild_id = $1
         RETURNING ${settingKey}`,
        [guildId],
      );

      const newValue = result.rows[0]?.[settingKey];

      logger.info(`Setting '${settingKey}' toggled to ${newValue} in table '${tableName}' for guild ${guildId}`);

      // Get feature display name and setting label from registry
      const featureDisplayName = FeatureRegistry[featureName]?.displayName || featureName;
      const settingLabel =
        FeatureRegistry[featureName]?.settings.find((s) => s.key === settingKey)?.label || settingKey;

      // Fire-and-forget audit log
      this.sendLog(
        client,
        guildId,
        '⚙️ Setting Changed',
        `**Feature:** ${featureDisplayName}\n**Setting:** ${settingLabel}\n**Status:** ${newValue ? 'Disabled → Enabled' : 'Enabled → Disabled'}\n**Changed by:** <@${userId}>`,
      ).catch((err) => logger.error('Failed to log setting change:', err));

      return {
        success: true,
        newValue,
      };
    } catch (error) {
      logger.error(`Error toggling setting ${settingKey}:`, error);
      return {
        success: false,
        error: 'Failed to toggle setting',
      };
    }
  }

  /**
   * Toggle show_inactive with invite message update
   */
  private async toggleShowInactive(guildId: string): Promise<ServerSettingsResponse> {
    try {
      // Toggle the setting
      const result = await pool.query(
        `UPDATE clan_invite_settings
         SET show_inactive = NOT show_inactive
         WHERE guild_id = $1
         RETURNING show_inactive, channel_id, message_id, pin_message`,
        [guildId],
      );

      if (result.rows.length === 0) {
        return {
          success: false,
          error: 'No invite settings found',
        };
      }

      const { show_inactive, channel_id, message_id, pin_message } = result.rows[0];

      logger.info(`show_inactive toggled to ${show_inactive} for guild ${guildId}`);

      // Return data needed to update invite message
      return {
        success: true,
        newValue: show_inactive,
        requiresInviteUpdate: true,
        inviteData: {
          channelId: channel_id,
          messageId: message_id,
          pinMessage: pin_message,
        },
      };
    } catch (error) {
      logger.error(`Error toggling show_inactive:`, error);
      return {
        success: false,
        error: 'Failed to toggle show_inactive',
      };
    }
  }

  /**
   * Toggle pin_message with Discord pin/unpin
   */
  private async togglePinMessage(guildId: string, client?: Client): Promise<ServerSettingsResponse> {
    try {
      // Toggle the setting and get the new value
      const { rows } = await pool.query(
        `UPDATE clan_invite_settings
         SET pin_message = NOT pin_message
         WHERE guild_id = $1
         RETURNING pin_message, channel_id, message_id`,
        [guildId],
      );

      if (rows.length === 0) {
        return {
          success: false,
          error: 'No invite settings found',
        };
      }

      const { pin_message: isNowPinned, channel_id, message_id } = rows[0];

      // Handle Discord pin/unpin if client is provided
      if (client) {
        try {
          const channel = await client.channels.fetch(channel_id);

          if (channel && channel.isTextBased() && (channel instanceof TextChannel || channel instanceof NewsChannel)) {
            const message = await channel.messages.fetch(message_id);

            if (isNowPinned) {
              await message.pin();
            } else {
              await message.unpin();
            }

            // Optionally delete the system pin message
            const recent = await channel.messages.fetch({ limit: 5 });
            const systemMessage = recent.find((msg) => msg.type === 6);
            if (systemMessage) await systemMessage.delete().catch(console.error);
          }
        } catch (err) {
          logger.error('Failed to pin/unpin message:', err);
          await interaction.followUp({ content: '⚠️ Failed to update message pin status on Discord. Please check the bot permissions and try again.' });
        }
      }

      logger.info(`pin_message ${isNowPinned ? 'enabled' : 'disabled'} for guild ${guildId}`);

      return {
        success: true,
        newValue: isNowPinned,
      };
    } catch (error) {
      logger.error(`Error toggling pin_message:`, error);
      return {
        success: false,
        error: 'Failed to toggle pin_message',
      };
    }
  }

  /**
   * Swap a setting value (like delete_method)
   */
  async swapSetting(params: SwapSettingParams): Promise<ServerSettingsResponse> {
    const { guildId, settingKey, tableName, featureName, client, userId } = params;

    try {
      if (settingKey === 'delete_method') {
        const result = await pool.query(
          `UPDATE ${tableName}
           SET delete_method = CASE
               WHEN delete_method = 'update' THEN 'delete'::delete_method_type
               ELSE 'update'::delete_method_type
             END
           WHERE guild_id = $1
           RETURNING delete_method`,
          [guildId],
        );

        const newValue = result.rows[0]?.delete_method;

        logger.info(`Setting '${settingKey}' swapped to ${newValue} in table '${tableName}' for guild ${guildId}`);

        // Get feature display name and setting label from registry
        const featureDisplayName = FeatureRegistry[featureName]?.displayName || featureName;
        const settingLabel =
          FeatureRegistry[featureName]?.settings.find((s) => s.key === settingKey)?.label || settingKey;

        // Fire-and-forget audit log
        this.sendLog(
          client,
          guildId,
          '🔄 Setting Changed',
          `**Feature:** ${featureDisplayName}\n**Setting:** ${settingLabel}\n**New Value:** ${newValue}\n**Changed by:** <@${userId}>`,
        ).catch((err) => logger.error('Failed to log setting swap:', err));

        return {
          success: true,
          newValue,
        };
      }

      // Add other swap types here as needed
      logger.warn(`Unhandled swap action for setting: ${settingKey}`);
      return {
        success: false,
        error: `Swap action for ${settingKey} not implemented yet`,
      };
    } catch (error) {
      logger.error(`Error swapping setting ${settingKey}:`, error);
      return {
        success: false,
        error: 'Failed to swap setting',
      };
    }
  }

  /**
   * Update a channel-based setting (logs_channel_id, category_id)
   */
  async updateChannelSetting(params: UpdateChannelSettingParams): Promise<ServerSettingsResponse> {
    const { guildId, settingKey, tableName, featureName, channelId, client, userId } = params;

    try {
      await pool.query(`UPDATE ${tableName} SET ${settingKey} = $1 WHERE guild_id = $2`, [channelId, guildId]);

      logger.info(`${settingKey} updated to ${channelId} for guild ${guildId}`);

      // Get feature display name and setting label from registry
      const featureDisplayName = FeatureRegistry[featureName]?.displayName || featureName;
      const settingLabel =
        FeatureRegistry[featureName]?.settings.find((s) => s.key === settingKey)?.label || settingKey;

      // Fire-and-forget audit log
      this.sendLog(
        client,
        guildId,
        '📝 Setting Updated',
        `**Feature:** ${featureDisplayName}\n**Setting:** ${settingLabel}\n**New Value:** <#${channelId}>\n**Changed by:** <@${userId}>`,
      ).catch((err) => logger.error('Failed to log channel setting update:', err));

      return {
        success: true,
        newValue: channelId,
      };
    } catch (error) {
      logger.error(`Error updating ${settingKey}:`, error);
      return {
        success: false,
        error: `Failed to update ${settingKey}`,
      };
    }
  }

  /**
   * Update a text-based setting
   */
  async updateTextSetting(params: UpdateTextSettingParams): Promise<ServerSettingsResponse> {
    const { guildId, settingKey, tableName, featureName, value, client, userId } = params;

    try {
      await pool.query(`UPDATE ${tableName} SET ${settingKey} = $1 WHERE guild_id = $2`, [value, guildId]);

      logger.info(`${settingKey} updated to '${value}' for guild ${guildId}`);

      // Get feature display name and setting label from registry
      const featureDisplayName = FeatureRegistry[featureName]?.displayName || featureName;
      const settingLabel =
        FeatureRegistry[featureName]?.settings.find((s) => s.key === settingKey)?.label || settingKey;

      // Fire-and-forget audit log
      this.sendLog(
        client,
        guildId,
        '📝 Setting Updated',
        `**Feature:** ${featureDisplayName}\n**Setting:** ${settingLabel}\n**New Value:** ${value}\n**Changed by:** <@${userId}>`,
      ).catch((err) => logger.error('Failed to log text setting update:', err));

      return {
        success: true,
        newValue: value,
      };
    } catch (error) {
      logger.error(`Error updating ${settingKey}:`, error);
      return {
        success: false,
        error: `Failed to update ${settingKey}`,
      };
    }
  }

  /**
   * Helper to update invite message (called after show_inactive toggle)
   */
  async updateInviteMessageAfterToggle(
    guildId: string,
    client: Client,
    inviteData: { channelId: string; messageId: string; pinMessage: boolean },
  ): Promise<void> {
    try {
      // Update the invite message
      const { embeds, components: inviteComponents } = await updateInviteMessage(pool, guildId);

      await repostInviteMessage({
        client,
        channelId: inviteData.channelId,
        messageId: inviteData.messageId,
        embeds,
        components: inviteComponents,
        pin: inviteData.pinMessage,
        pool,
        guildId,
      });
    } catch (error) {
      logger.error('Error updating invite message:', error);
      throw error;
    }
  }
}

// Singleton instance
export const serverSettingsService = new ServerSettingsService();
