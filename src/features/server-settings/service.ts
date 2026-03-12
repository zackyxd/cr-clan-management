import { pool } from '../../db.js';
import { TextChannel, NewsChannel, Client } from 'discord.js';
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
   * Toggle a feature on/off
   */
  async toggleFeature(guildId: string, featureName: string): Promise<ServerSettingsResponse> {
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
        [guildId, featureName, newValue]
      );

      logger.info(`Feature '${featureName}' ${newValue ? 'enabled' : 'disabled'} for guild ${guildId}`);

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
    const { guildId, settingKey, tableName, client } = params;

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
        [guildId]
      );

      const newValue = result.rows[0]?.[settingKey];

      logger.info(`Setting '${settingKey}' toggled to ${newValue} in table '${tableName}' for guild ${guildId}`);

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
        [guildId]
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
        [guildId]
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
    const { guildId, settingKey, tableName } = params;

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
          [guildId]
        );

        const newValue = result.rows[0]?.delete_method;

        logger.info(`Setting '${settingKey}' swapped to ${newValue} in table '${tableName}' for guild ${guildId}`);

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
    const { guildId, settingKey, tableName, channelId } = params;

    try {
      await pool.query(`UPDATE ${tableName} SET ${settingKey} = $1 WHERE guild_id = $2`, [channelId, guildId]);

      logger.info(`${settingKey} updated to ${channelId} for guild ${guildId}`);

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
    const { guildId, settingKey, tableName, value } = params;

    try {
      await pool.query(`UPDATE ${tableName} SET ${settingKey} = $1 WHERE guild_id = $2`, [value, guildId]);

      logger.info(`${settingKey} updated to '${value}' for guild ${guildId}`);

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
    inviteData: { channelId: string; messageId: string; pinMessage: boolean }
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
