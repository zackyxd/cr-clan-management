import { pool } from '../../db.js';
import { fetchClanName } from '../../services/clans.js';
import { repostInviteMessage, updateInviteMessage } from '../clan-invites/messageManager.js';
import { getClanSettingsData } from '../../cache/clanSettingsDataCache.js';
import logger from '../../logger.js';
import type {
  ClanSettings,
  ClanSettingsData,
  ClanSettingsResponse,
  ClanInviteSettings,
  ButtonInteraction,
} from './types.js';
import { Client, EmbedBuilder, NewsChannel, TextChannel } from 'discord.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';

/**
 * Core service class for managing clan settings functionality
 * Handles all business logic for clan configuration
 */
export class ClanSettingsService {
  /**
   * Get cached clan settings data
   */
  getCachedSettingsData(cacheKey: string): ClanSettingsData | null {
    return getClanSettingsData(cacheKey) || null;
  }

  /**
   * Send audit log
   * @param client - Discord client instance
   * @param guildId - Guild ID for the log
   * @param title - Log title
   * @param description - Log description
   */
  async sendLog(client: Client, guildId: string, title: string, description: string): Promise<void> {
    try {
      const settingsResult = await pool.query(
        `SELECT logs_channel_id, send_logs FROM server_settings WHERE guild_id = $1`,
        [guildId],
      );

      const { logs_channel_id, send_logs } = settingsResult.rows[0] || {};

      if (!send_logs || !logs_channel_id) return;

      const channel = await client.channels.fetch(logs_channel_id);
      if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
        console.log(`Couldn't find valid logs channel for guild ${guildId} for server settings.`);
        return;
      }
      const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(BOTCOLOR);
      await channel.send({ embeds: [embed] });
    } catch (error) {
      logger.error('Error sending clan settings log:', error);
    }
  }

  /**
   * Update clan abbreviation
   */
  async updateAbbreviation(guildId: string, clantag: string, abbreviation: string): Promise<ClanSettingsResponse> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1️⃣ Check if abbreviation already exists for another clan
      const existingRes = await client.query(
        `SELECT clan_name FROM clans WHERE guild_id = $1 AND abbreviation = $2 AND clantag != $3`,
        [guildId, abbreviation, clantag],
      );

      if (existingRes.rows.length > 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: `❌ Abbreviation "${abbreviation}" is already used by clan: ${existingRes.rows[0].clan_name}`,
        };
      }

      // 2️⃣ Update the clan abbreviation
      await client.query(`UPDATE clans SET abbreviation = $1 WHERE guild_id = $2 AND clantag = $3`, [
        abbreviation,
        guildId,
        clantag,
      ]);

      await client.query('COMMIT');

      return { success: true };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error updating clan abbreviation:', error);
      return {
        success: false,
        error: 'Failed to update abbreviation. Please try again.',
      };
    } finally {
      client.release();
    }
  }

  /**
   * Update clan role ID
   */
  async updateClanRole(
    client: Client,
    guildId: string,
    clantag: string,
    roleId: string,
    userId: string,
  ): Promise<ClanSettingsResponse> {
    try {
      const oldResult = await pool.query(
        `SELECT clan_role_id, clan_name FROM clans WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );
      const oldRoleId = oldResult.rows[0]?.clan_role_id;
      const clanName = oldResult.rows[0]?.clan_name;

      // Simple direct update to clans table
      await pool.query(`UPDATE clans SET clan_role_id = $1 WHERE guild_id = $2 AND clantag = $3`, [
        roleId,
        guildId,
        clantag,
      ]);

      // TODO new emoji
      this.sendLog(
        client,
        guildId,
        `🪧 Clan Setting Changed`,
        `**Clan Role:**\nClan: ${clanName}\n${oldRoleId ? `<@&${oldRoleId}>` : 'None'} → <@&${roleId}>\n**Changed by:** <@${userId}>`,
      ).catch((err) => logger.error('Error sending clan role update log:', err));

      return { success: true };
    } catch (error) {
      logger.error('Error updating clan role:', error);
      return {
        success: false,
        error: 'Failed to update clan role. Please try again.',
      };
    }
  }

  /**
   * Generic method to update a specific clan setting
   */
  async updateClanSetting(
    client: Client,
    guildId: string,
    clantag: string,
    settingKey: string,
    value: string | boolean,
    userId: string,
  ): Promise<ClanSettingsResponse> {
    try {
      const oldResult = await pool.query(
        `SELECT ${settingKey}, clan_name FROM clans WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );
      const oldValue = oldResult.rows[0]?.[settingKey];
      const clanName = oldResult.rows[0]?.clan_name;

      // Simple direct update to clans table
      await pool.query(`UPDATE clans SET ${settingKey} = $1 WHERE guild_id = $2 AND clantag = $3`, [
        value,
        guildId,
        clantag,
      ]);

      const settingLabel = settingKey.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
      this.sendLog(
        client,
        guildId,
        `🪧 Clan Setting Changed`,
        `**${settingLabel}:**\nClan: ${clanName}\n${oldValue ? `<#${oldValue}>` : 'None'} → <#${value}>\n**Changed by:** <@${userId}>`,
      ).catch((err) => logger.error('Error sending clan setting update log:', err));

      return { success: true };
    } catch (error) {
      logger.error(`Error updating clan setting ${settingKey}:`, error);
      return {
        success: false,
        error: `Failed to update ${settingKey}. Please try again.`,
      };
    }
  }

  /**   * Update custom nudge message
   */
  async updateCustomNudgeMessage(
    client: Client,
    guildId: string,
    clantag: string,
    message: string,
    userId: string,
  ): Promise<ClanSettingsResponse> {
    try {
      const oldResult = await pool.query(
        `SELECT race_custom_nudge_message, clan_name FROM clans WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );
      const oldMessage = oldResult.rows[0]?.race_custom_nudge_message;
      const clanName = oldResult.rows[0]?.clan_name;

      // Update the custom message (null means use default)
      const finalMessage = message.trim() || null;
      await pool.query(
        `UPDATE clans SET race_custom_nudge_message = $1 WHERE guild_id = $2 AND clantag = $3`,
        [finalMessage, guildId, clantag],
      );

      // Get updated settings
      const settings = await this.getCurrentSettings(guildId, clantag);

      this.sendLog(
        client,
        guildId,
        `🪧 Clan Setting Changed`,
        `**Custom Nudge Message:**\nClan: ${clanName}\n${oldMessage || 'Default'} → ${finalMessage || 'Default'}\n**Changed by:** <@${userId}>`,
      ).catch((err) => logger.error('Error sending custom nudge message update log:', err));

      return { success: true, settings };
    } catch (error) {
      logger.error('Error updating custom nudge message:', error);
      return {
        success: false,
        error: 'Failed to update custom nudge message. Please try again.',
      };
    }
  }

  /**
   * Update nudge schedule settings
   */
  async updateNudgeSchedule(
    client: Client,
    guildId: string,
    clantag: string,
    startHour: number,
    startMinute: number,
    intervalHours: number,
    userId: string,
  ): Promise<ClanSettingsResponse> {
    try {
      const oldResult = await pool.query(
        `SELECT race_nudge_start_hour, race_nudge_start_minute, race_nudge_interval_hours, clan_name 
         FROM clans WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );
      const oldRow = oldResult.rows[0];
      const clanName = oldRow?.clan_name;

      // Update the schedule
      await pool.query(
        `UPDATE clans 
         SET race_nudge_start_hour = $1, 
             race_nudge_start_minute = $2, 
             race_nudge_interval_hours = $3 
         WHERE guild_id = $4 AND clantag = $5`,
        [startHour, startMinute, intervalHours, guildId, clantag],
      );

      // Get updated settings
      const settings = await this.getCurrentSettings(guildId, clantag);

      const oldSchedule = oldRow?.race_nudge_start_hour !== null 
        ? `${String(oldRow.race_nudge_start_hour).padStart(2, '0')}:${String(oldRow.race_nudge_start_minute).padStart(2, '0')} every ${oldRow.race_nudge_interval_hours}h`
        : 'Not set';
      const newSchedule = `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')} every ${intervalHours}h`;

      this.sendLog(
        client,
        guildId,
        `⏰ Clan Setting Changed`,
        `**Nudge Schedule:**\nClan: ${clanName}\n${oldSchedule} → ${newSchedule}\n**Changed by:** <@${userId}>`,
      ).catch((err) => logger.error('Error sending nudge schedule update log:', err));

      return { success: true, settings };
    } catch (error) {
      logger.error('Error updating nudge schedule:', error);
      return {
        success: false,
        error: 'Failed to update nudge schedule. Please try again.',
      };
    }
  }

  /**   * Fetch current clan settings from database
   */
  async getCurrentSettings(guildId: string, clantag: string): Promise<ClanSettings> {
    const res = await pool.query(
      `SELECT family_clan, nudge_enabled, race_nudge_channel_id, race_custom_nudge_message, 
              race_nudge_start_hour, race_nudge_start_minute, race_nudge_interval_hours,
              staff_channel_id, eod_stats_enabled, invites_enabled, clan_role_id, abbreviation 
       FROM clans WHERE guild_id = $1 AND clantag = $2`,
      [guildId, clantag],
    );

    if (res.rows.length === 0) {
      // Return defaults if clan not found
      return {
        family_clan: false,
        nudge_enabled: false,
        race_nudge_channel_id: undefined,
        race_custom_nudge_message: undefined,
        staff_channel_id: undefined,
        eod_stats_enabled: false,
        invites_enabled: false,
        clan_role_id: undefined,
        abbreviation: undefined,
      };
    }

    return res.rows[0];
  }

  /**
   * Toggle family clan status with validation
   */
  async toggleFamilyClan(
    client: Client,
    guildId: string,
    clantag: string,
    userId: string,
  ): Promise<ClanSettingsResponse> {
    const dbClient = await pool.connect();

    try {
      await dbClient.query('BEGIN');

      // 1️⃣ Get current family_clan status directly from clans table
      const currentRes = await dbClient.query(
        `SELECT family_clan, clan_name FROM clans WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );

      const currentFamilyClan = currentRes.rows[0]?.family_clan || false;
      const clanName = currentRes.rows[0]?.clan_name;

      // 2️⃣ Check family clan limit if enabling
      if (!currentFamilyClan) {
        const countRes = await dbClient.query(
          `SELECT COUNT(*)::int FROM clans 
           WHERE guild_id = $1 AND family_clan = true`,
          [guildId],
        );

        const maxFamilyClansRes = await dbClient.query(
          `SELECT max_family_clans FROM server_settings WHERE guild_id = $1`,
          [guildId],
        );

        if (countRes.rows[0].count >= maxFamilyClansRes.rows[0].max_family_clans) {
          await dbClient.query('ROLLBACK');
          return {
            success: false,
            error: `This server already has the maximum **${maxFamilyClansRes.rows[0].max_family_clans}** family clans allowed.`,
          };
        }
      }

      // 3️⃣ Toggle the family_clan setting in clans table
      const newFamilyClan = !currentFamilyClan;
      await dbClient.query(`UPDATE clans SET family_clan = $1 WHERE guild_id = $2 AND clantag = $3`, [
        newFamilyClan,
        guildId,
        clantag,
      ]);

      await dbClient.query('COMMIT');

      // Return the updated settings
      const updatedSettings = await this.getCurrentSettings(guildId, clantag);

      this.sendLog(
        client,
        guildId,
        `🪧 Clan Setting Changed`,
        `**Family Clan Status:**\nClan: ${clanName}\n${currentFamilyClan ? 'Enabled → Disabled' : 'Disabled → Enabled'}\n**Changed by:** <@${userId}>`,
      ).catch((err) => logger.error('Error sending clan setting update log:', err));

      return { success: true, settings: updatedSettings };
    } catch (error) {
      await dbClient.query('ROLLBACK');
      logger.error('Error toggling family_clan:', error);
      return {
        success: false,
        error: 'There was an error setting this clan as family clan.',
      };
    } finally {
      dbClient.release();
    }
  }

  /**
   * Toggle nudge enabled setting
   */
  async toggleNudgeEnabled(
    client: Client,
    guildId: string,
    clantag: string,
    userId: string,
  ): Promise<ClanSettingsResponse> {
    try {
      const oldResult = await pool.query(
        `SELECT nudge_enabled, clan_name FROM clans WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );
      const currentNudgeEnabled = oldResult.rows[0]?.nudge_enabled ?? false;
      const clanName = oldResult.rows[0]?.clan_name;

      // Simple direct update to clans table
      await pool.query(`UPDATE clans SET nudge_enabled = NOT nudge_enabled WHERE guild_id = $1 AND clantag = $2`, [
        guildId,
        clantag,
      ]);

      // Get updated settings
      const settings = await this.getCurrentSettings(guildId, clantag);

      this.sendLog(
        client,
        guildId,
        `🪧 Clan Setting Changed`,
        `**Nudge Status:**\nClan: ${clanName}\n${currentNudgeEnabled ? 'Enabled → Disabled' : 'Disabled → Enabled'}\n**Changed by:** <@${userId}>`,
      ).catch((err) => logger.error('Error sending clan setting nudge update log:', err));
      return { success: true, settings };
    } catch (error) {
      logger.error('Error toggling nudge_enabled:', error);
      return {
        success: false,
        error: 'There was an error toggling nudge settings.',
      };
    }
  }

  /**
   * Toggle end-of-day stats enabled setting
   */
  async toggleEodStatsEnabled(
    interaction: ButtonInteraction,
    guildId: string,
    clantag: string,
    userId: string,
  ): Promise<ClanSettingsResponse> {
    try {
      const oldResult = await pool.query(
        `SELECT eod_stats_enabled, clan_name, staff_channel_id FROM clans WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );
      const currentEodStatsEnabled = oldResult.rows[0]?.eod_stats_enabled ?? false;
      const clanName = oldResult.rows[0]?.clan_name;
      const staffChannelId = oldResult.rows[0]?.staff_channel_id;

      const staffChannel = staffChannelId ? await interaction.client.channels.fetch(staffChannelId) : null;
      // Simple direct update to clans table
      await pool.query(
        `UPDATE clans SET eod_stats_enabled = NOT eod_stats_enabled WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );

      // Get updated settings
      const settings = await this.getCurrentSettings(guildId, clantag);

      this.sendLog(
        interaction.client,
        guildId,
        `🪧 Clan Setting Changed`,
        `**End-of-Day Stats:**\nClan: ${clanName}\n${currentEodStatsEnabled ? 'Enabled → Disabled' : 'Disabled → Enabled'}\n**Changed by:** <@${userId}>`,
      ).catch((err) => logger.error('Error sending clan setting eod stats update log:', err));

      if (!staffChannel && settings.eod_stats_enabled == true) {
        await interaction.followUp({
          content:
            '⚠️ No staff channel configured for this clan. Make sure you set one or else races will not get auto-posted.',
          ephemeral: true,
        });
      }
      return { success: true, settings };
    } catch (error) {
      logger.error('Error toggling eod_stats_enabled:', error);
      return {
        success: false,
        error: 'There was an error toggling end-of-day stats settings.',
      };
    }
  }

  /**
   * Toggle invites enabled setting
   */
  async toggleInvitesEnabled(
    guildId: string,
    clantag: string,
  ): Promise<
    ClanSettingsResponse & { inviteUpdateNeeded?: boolean; inviteSettings?: ClanInviteSettings; warning?: string }
  > {
    try {
      // Simple direct update to clans table
      await pool.query(`UPDATE clans SET invites_enabled = NOT invites_enabled WHERE guild_id = $1 AND clantag = $2`, [
        guildId,
        clantag,
      ]);

      // Get updated settings
      const settings = await this.getCurrentSettings(guildId, clantag);

      // Check if invite message needs updating
      const inviteData = await this.getInviteSettings(guildId, clantag);

      if (inviteData) {
        return {
          success: true,
          settings,
          inviteUpdateNeeded: true,
          inviteSettings: inviteData,
        };
      } else {
        // No invite settings configured - provide helpful feedback only when enabling
        return {
          success: true,
          settings,
          warning: settings.invites_enabled
            ? '✅ Invites enabled! To display clan invites in a channel, have an admin run `/set-clan-invite-channel`.'
            : undefined, // No message when disabling
        };
      }
    } catch (error) {
      logger.error('Error toggling invites_enabled:', error);
      return {
        success: false,
        error: 'There was an error toggling invite settings.',
      };
    }
  }

  /**
   * Get invite settings for a clan
   */
  private async getInviteSettings(guildId: string, clantag: string): Promise<ClanInviteSettings | null> {
    const { rows } = await pool.query(
      `SELECT cis.channel_id,
              cis.message_id,
              cis.pin_message,
              c.invites_enabled
       FROM clan_invite_settings cis
       JOIN clans c ON cis.guild_id = c.guild_id AND c.clantag = $2
       WHERE cis.guild_id = $1
       LIMIT 1`,
      [guildId, clantag],
    );

    if (rows.length === 0) return null;

    const { channel_id, message_id, pin_message, invites_enabled } = rows[0];

    // Return null if channel or message not properly configured
    if (!channel_id || !message_id) {
      return null;
    }

    return { channel_id, message_id, pin_message, invites_enabled };
  }

  /**
   * Get clan name (cached or fetched)
   */
  async getClanName(guildId: string, clantag: string): Promise<string> {
    return await fetchClanName(guildId, clantag);
  }

  /**
   * Handle invite message update (to be called by router with Discord client)
   */
  async handleInviteMessageUpdate(
    inviteSettings: ClanInviteSettings,
    guildId: string,
    discordClient: unknown,
  ): Promise<void> {
    const { embeds, components } = await updateInviteMessage(pool, guildId);

    await repostInviteMessage({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: discordClient as any, // Type assertion for external function
      channelId: inviteSettings.channel_id,
      messageId: inviteSettings.message_id,
      embeds,
      components,
      pin: inviteSettings.pin_message,
      pool: pool,
      guildId,
    });
  }
}

// Singleton instance
export const clanSettingsService = new ClanSettingsService();
