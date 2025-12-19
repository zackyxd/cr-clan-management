import { pool } from '../../db.js';
import { fetchClanName } from '../../services/clans.js';
import { repostInviteMessage, updateInviteMessage } from '../../commands/staff_commands/updateClanInvite.js';
import { getClanSettingsData } from '../../cache/clanSettingsDataCache.js';
import logger from '../../logger.js';
import type { ClanSettings, ClanSettingsData, ClanSettingsResponse, ClanInviteSettings } from './types.js';

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
   * Update clan abbreviation
   */
  async updateAbbreviation(guildId: string, clantag: string, abbreviation: string): Promise<ClanSettingsResponse> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1️⃣ Check if abbreviation already exists for another clan
      const existingRes = await client.query(
        `SELECT clan_name FROM clans WHERE guild_id = $1 AND abbreviation = $2 AND clantag != $3`,
        [guildId, abbreviation, clantag]
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
  async updateClanRole(guildId: string, clantag: string, roleId: string): Promise<ClanSettingsResponse> {
    try {
      // Simple direct update to clans table
      await pool.query(`UPDATE clans SET clan_role_id = $1 WHERE guild_id = $2 AND clantag = $3`, [
        roleId,
        guildId,
        clantag,
      ]);

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
   * Fetch current clan settings from database
   */
  async getCurrentSettings(guildId: string, clantag: string): Promise<ClanSettings> {
    const res = await pool.query(
      `SELECT family_clan, nudge_enabled, invites_enabled, clan_role_id, abbreviation 
       FROM clans WHERE guild_id = $1 AND clantag = $2`,
      [guildId, clantag]
    );

    if (res.rows.length === 0) {
      // Return defaults if clan not found
      return {
        family_clan: false,
        nudge_enabled: false,
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
  async toggleFamilyClan(guildId: string, clantag: string): Promise<ClanSettingsResponse> {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1️⃣ Get current family_clan status directly from clans table
      const currentRes = await client.query(`SELECT family_clan FROM clans WHERE guild_id = $1 AND clantag = $2`, [
        guildId,
        clantag,
      ]);

      const currentFamilyClan = currentRes.rows[0]?.family_clan || false;

      // 2️⃣ Check family clan limit if enabling
      if (!currentFamilyClan) {
        const countRes = await client.query(
          `SELECT COUNT(*)::int FROM clans 
           WHERE guild_id = $1 AND family_clan = true`,
          [guildId]
        );

        const maxFamilyClansRes = await client.query(
          `SELECT max_family_clans FROM server_settings WHERE guild_id = $1`,
          [guildId]
        );

        if (countRes.rows[0].count >= maxFamilyClansRes.rows[0].max_family_clans) {
          await client.query('ROLLBACK');
          return {
            success: false,
            error: `This server already has the maximum **${maxFamilyClansRes.rows[0].max_family_clans}** family clans allowed.`,
          };
        }
      }

      // 3️⃣ Toggle the family_clan setting in clans table
      const newFamilyClan = !currentFamilyClan;
      await client.query(`UPDATE clans SET family_clan = $1 WHERE guild_id = $2 AND clantag = $3`, [
        newFamilyClan,
        guildId,
        clantag,
      ]);

      await client.query('COMMIT');

      // Return the updated settings
      const updatedSettings = await this.getCurrentSettings(guildId, clantag);
      return { success: true, settings: updatedSettings };
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Error toggling family_clan:', error);
      return {
        success: false,
        error: 'There was an error setting this clan as family clan.',
      };
    } finally {
      client.release();
    }
  }

  /**
   * Toggle nudge enabled setting
   */
  async toggleNudgeEnabled(guildId: string, clantag: string): Promise<ClanSettingsResponse> {
    try {
      // Simple direct update to clans table
      await pool.query(`UPDATE clans SET nudge_enabled = NOT nudge_enabled WHERE guild_id = $1 AND clantag = $2`, [
        guildId,
        clantag,
      ]);

      // Get updated settings
      const settings = await this.getCurrentSettings(guildId, clantag);
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
   * Toggle invites enabled setting
   */
  async toggleInvitesEnabled(
    guildId: string,
    clantag: string
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
      [guildId, clantag]
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
    discordClient: unknown
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
