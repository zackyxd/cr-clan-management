import { Client, TextChannel, NewsChannel, Message, EmbedBuilder } from 'discord.js';
import { pool } from '../../db.js';
import type { InviteLink, InviteSourceType } from './types.js';
import logger from '../../logger.js';
import { createInviteEmbed } from './utils.js';
import { EmbedColor } from '../../types/EmbedUtil.js';

export class ClanInviteService {
  /**
   * Send a log message to the configured log channel if logging is enabled
   */
  async sendLog(client: Client, guildId: string, title: string, description: string): Promise<void> {
    try {
      const settingsResult = await pool.query(
        `SELECT cis.send_logs, ss.logs_channel_id 
         FROM clan_invite_settings cis
         JOIN server_settings ss ON ss.guild_id = cis.guild_id
         WHERE cis.guild_id = $1`,
        [guildId],
      );

      if (!settingsResult.rows[0]) return;

      const { send_logs, logs_channel_id } = settingsResult.rows[0];

      if (!send_logs || !logs_channel_id) return;

      const channel = await client.channels.fetch(logs_channel_id);
      if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
        logger.warn(`Log channel ${logs_channel_id} not found or not text-based`);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(EmbedColor.LOGS)
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (error) {
      logger.error('Error sending clan invite log:', error);
    }
  }
  /**
   * Create a new invite link entry in the database
   * @returns The ID of the newly created invite link
   */
  async createInviteLink(
    client: Client,
    guildId: string,
    clantag: string,
    inviteLink: string,
    createdBy: string,
    expiresAt: Date,
    clanName?: string,
  ): Promise<number> {
    const result = await pool.query(
      `INSERT INTO clan_invites_links
       (guild_id, clantag, invite_link, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [guildId, clantag, inviteLink, createdBy, expiresAt],
    );

    const linkId = result.rows[0].id;
    logger.info(`Created invite link for ${clantag} in guild ${guildId}`);

    // Send log if enabled
    await this.sendLog(
      client,
      guildId,
      '🔗 New Invite Link Created',
      `**Created by:** <@${createdBy}>\n**Clan:** ${clanName || clantag}\n**Tag:** ${clantag}\n**Link:** ${inviteLink}\n**Expires:** <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`,
    );

    return linkId;
  }

  /**
   * Get the active (non-expired) invite link for a clan
   */
  async getActiveInvite(guildId: string, clantag: string): Promise<InviteLink | null> {
    const result = await pool.query(
      `SELECT * FROM clan_invites_links
       WHERE guild_id = $1 AND clantag = $2
         AND expires_at > NOW() AND is_expired = FALSE
       ORDER BY created_at DESC
       LIMIT 1`,
      [guildId, clantag],
    );

    return result.rows[0] || null;
  }

  /**
   * Get active invite with clan name included
   */
  async getActiveInviteWithClan(guildId: string, clantag: string): Promise<InviteLink | null> {
    const result = await pool.query(
      `SELECT 
         cil.*,
         c.clan_name
       FROM clan_invites_links cil
       JOIN clans c ON c.guild_id = cil.guild_id AND c.clantag = cil.clantag
       WHERE cil.guild_id = $1 AND cil.clantag = $2
         AND cil.expires_at > NOW() AND cil.is_expired = FALSE
       ORDER BY cil.created_at DESC
       LIMIT 1`,
      [guildId, clantag],
    );

    return result.rows[0] || null;
  }

  /**
   * Get all messages associated with an invite link
   */
  async getInviteLinkMessages(inviteLinkId: number) {
    const result = await pool.query(
      `SELECT * FROM invite_link_messages
       WHERE invite_link_id = $1
       ORDER BY created_at DESC`,
      [inviteLinkId],
    );

    return result.rows;
  }

  /**
   * Mark an invite link as expired
   */
  async markInviteAsExpired(
    client: Client,
    inviteLinkId: number,
    guildId: string,
    clantag: string,
    clanName?: string,
  ): Promise<void> {
    await pool.query(
      `UPDATE clan_invites_links
       SET is_expired = TRUE
       WHERE id = $1`,
      [inviteLinkId],
    );

    logger.info(`Marked invite link ${inviteLinkId} as expired for ${clantag}`);
  }

  /**
   * Delete old expired invite links (cleanup)
   */
  async cleanupOldExpiredLinks(daysOld: number = 30): Promise<number> {
    const result = await pool.query(
      `DELETE FROM clan_invites_links
       WHERE is_expired = TRUE 
         AND expires_at < NOW() - INTERVAL '${daysOld} days'
       RETURNING id`,
    );

    const deletedCount = result.rowCount || 0;
    if (deletedCount > 0) {
      logger.info(`Cleaned up ${deletedCount} old expired invite links`);
    }

    return deletedCount;
  }

  /**
   * Get all active invites for a guild (for the main invite list message)
   * Returns only the most recent invite link per clan
   */
  async getActiveInvitesForGuild(guildId: string) {
    const result = await pool.query(
      `SELECT 
         cil.*,
         c.clan_name,
         c.clan_trophies,
         c.abbreviation,
         c.invites_enabled,
         c.clan_role_id AS role_id
       FROM (
         SELECT DISTINCT ON (clantag)
           *
         FROM clan_invites_links
         WHERE guild_id = $1
           AND expires_at > NOW() 
           AND is_expired = FALSE
         ORDER BY clantag, created_at DESC
       ) cil
       JOIN clans c ON c.guild_id = cil.guild_id AND c.clantag = cil.clantag
       ORDER BY c.clan_trophies DESC`,
      [guildId],
    );

    return result.rows;
  }

  /**
   * Send an invite link to a specific channel
   * @returns The sent message or null if failed
   */
  async sendInviteToChannel(
    client: Client,
    guildId: string,
    channelId: string,
    clantag: string,
    sourceType: InviteSourceType,
    sentByUserId: string,
    content?: string,
  ): Promise<Message | null> {
    // Get active invite
    const invite = await this.getActiveInviteWithClan(guildId, clantag);

    if (!invite) {
      logger.warn(`No active invite found for ${clantag} in guild ${guildId}`);
      return null;
    }

    // Fetch channel
    const channel = await client.channels.fetch(channelId);
    if (!channel || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
      logger.warn(`Channel ${channelId} not found or not text-based`);
      return null;
    }

    // Create and send embed
    const embed = createInviteEmbed(invite.clan_name, invite.invite_link, invite.expires_at);
    const message = await channel.send({
      content: content || undefined,
      embeds: [embed],
    });

    // Track the message
    await this.trackInviteMessage(invite.id, guildId, channelId, message.id, sourceType, sentByUserId);

    logger.info(`Sent invite for ${clantag} to channel ${channelId} in guild ${guildId}`);

    // Send log if enabled
    await this.sendLog(
      client,
      guildId,
      '📤 Invite Link Sent',
      `**Sent by:** <@${sentByUserId}>\n**Clan:** ${invite.clan_name}\n**Tag:** ${clantag}\n**Channel:** <#${channelId}>\n**Source:** ${sourceType}\n**Link used:** ${invite.invite_link}\n**Expires:** <t:${Math.floor(invite.expires_at.getTime() / 1000)}:R>`,
    );

    return message;
  }

  /**
   * Track where an invite link message was posted
   */
  async trackInviteMessage(
    inviteLinkId: number,
    guildId: string,
    channelId: string,
    messageId: string,
    sourceType: InviteSourceType,
    sentByUserId: string,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO invite_link_messages
       (invite_link_id, guild_id, channel_id, message_id, source_type, sent_by_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (channel_id, message_id) 
       DO UPDATE SET 
         invite_link_id = EXCLUDED.invite_link_id,
         source_type = EXCLUDED.source_type,
         sent_by_id = EXCLUDED.sent_by_id`,
      [inviteLinkId, guildId, channelId, messageId, sourceType, sentByUserId],
    );

    logger.info(`Tracked invite message ${messageId} in channel ${channelId} for link ${inviteLinkId}`);
  }
}

export const clanInviteService = new ClanInviteService();
