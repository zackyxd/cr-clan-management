import { pool } from '../../db.js';
import { CR_API, FetchError } from '../../api/CR_API.js';
import { formatPlayerData } from '../../api/FORMAT_DATA.js';
import { linkUser } from '../../services/users.js';
import logger from '../../logger.js';
import { Client, EmbedBuilder, NewsChannel, TextChannel } from 'discord.js';
import type {
  TicketResponse,
  AddPlayertagsParams,
  CloseTicketParams,
  TicketFeatureCheck,
  TicketData,
} from './types.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { StatsTracker } from '../../services/statsTracker.js';

/**
 * Core service class for managing ticket functionality
 * Handles all business logic for ticket operations
 */
export class TicketService {
  async sendLog(client: Client, guildId: string, title: string, description: string): Promise<void> {
    try {
      const settingsResult = await pool.query(
        `SELECT ts.send_logs, ss.logs_channel_id 
         FROM ticket_settings ts
         JOIN server_settings ss ON ss.guild_id = ts.guild_id
         WHERE ts.guild_id = $1`,
        [guildId],
      );
      const { send_logs, logs_channel_id } = settingsResult.rows[0] || {};

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
      logger.error('Error sending ticket log:', error);
    }
  }

  /**
   * Check if ticket feature is enabled for a guild
   */
  async isFeatureEnabled(guildId: string): Promise<TicketFeatureCheck> {
    const { rows } = await pool.query(
      `
      SELECT gf.is_enabled, ts.opened_identifier, ts.closed_identifier
      FROM guild_features gf
      JOIN ticket_settings ts ON ts.guild_id = gf.guild_id
      WHERE gf.guild_id = $1 
        AND gf.feature_name = 'tickets'
        AND gf.is_enabled = TRUE
      `,
      [guildId],
    );

    if (rows.length === 0) {
      return { enabled: false };
    }

    return {
      enabled: true,
      settings: {
        guildId,
        openedIdentifier: rows[0].opened_identifier,
        closedIdentifier: rows[0].closed_identifier,
      },
    };
  }

  /**
   * Get ticket data for a channel
   */
  async getTicketData(guildId: string, channelId: string): Promise<TicketData | null> {
    const { rows } = await pool.query(
      `
      SELECT guild_id, channel_id, playertags, created_by, is_closed, created_at, closed_at
      FROM tickets
      WHERE guild_id = $1 AND channel_id = $2
      `,
      [guildId, channelId],
    );

    if (rows.length === 0) {
      return null;
    }

    return {
      guildId: rows[0].guild_id,
      channelId: rows[0].channel_id,
      playertags: rows[0].playertags,
      createdBy: rows[0].created_by,
      isClosed: rows[0].is_closed,
      createdAt: rows[0].created_at,
      closedAt: rows[0].closed_at,
    };
  }

  /**
   * Add playertags to a ticket
   */
  async addPlayertags(params: AddPlayertagsParams): Promise<TicketResponse> {
    const { guildId, channelId, playertags, userId } = params;

    try {
      // Get current ticket data including creator
      const { rows } = await pool.query(
        `SELECT playertags, created_by FROM tickets WHERE guild_id = $1 AND channel_id = $2`,
        [guildId, channelId],
      );

      // Check if ticket exists
      if (rows.length === 0) {
        logger.warn(`Ticket not found for guild ${guildId}, channel ${channelId}`);
        return {
          success: false,
          error: 'Ticket not found. Please ensure this is a valid ticket channel.',
        };
      }

      const ticketData = rows[0];
      const currentTags: string[] = ticketData?.playertags ?? [];
      const existingOwner = ticketData?.created_by;

      // Check if ticket already has an owner and it's not the current user
      if (existingOwner && existingOwner !== userId) {
        logger.warn(`User ${userId} attempted to add tags to ticket owned by ${existingOwner}`);
        return {
          success: false,
          error: 'Someone has already uploaded their playertags to this ticket. Please make your own ticket.',
        };
      }
      const validTags: string[] = [];
      const embeds: EmbedBuilder[] = [];
      const invalidEmbeds: EmbedBuilder[] = [];

      // Process each playertag
      for (let tag of playertags) {
        tag = CR_API.normalizeTag(tag);

        if (currentTags.includes(tag)) continue; // skip duplicates

        const playerData = await CR_API.getPlayer(tag);

        if ('error' in playerData) {
          // playerData is a FetchError
          const fetchError = playerData as FetchError;
          if (fetchError.embed) {
            invalidEmbeds.push(fetchError.embed);
          }
          continue;
        }

        // playerData is now narrowed to Player
        const embed = formatPlayerData(playerData);
        if (embed) embeds.push(embed);
        validTags.push(tag);
      }

      const uniqueValidTags = [...new Set(validTags)];

      // Update database
      if (uniqueValidTags.length > 0) {
        // If no existing owner, set the current user as owner and add playertags
        // If owner exists (same user), just add playertags
        await pool.query(
          `
          UPDATE tickets
          SET 
            playertags = (
              SELECT ARRAY(
                SELECT DISTINCT unnest(playertags || $3::text[])
                ORDER BY 1
              )
            ),
            created_by = COALESCE(created_by, $4)
          WHERE guild_id = $1 AND channel_id = $2
          `,
          [guildId, channelId, uniqueValidTags, userId],
        );
      }

      logger.info(`Added ${uniqueValidTags.length} playertags to ticket in guild ${guildId}`);

      return {
        success: true,
        validTags: uniqueValidTags,
        embeds,
        invalidEmbeds,
      };
    } catch (error) {
      logger.error('Error adding playertags to ticket:', error);
      return {
        success: false,
        error: 'Failed to add playertags to ticket',
      };
    }
  }

  /**
   * Close a ticket and auto-link users
   */
  async closeTicket(params: CloseTicketParams): Promise<TicketResponse> {
    const { guildId, channelId, client } = params;

    const dbClient = await pool.connect();

    try {
      await dbClient.query('BEGIN');

      // Update ticket status
      await dbClient.query(
        `
        UPDATE tickets
        SET is_closed = TRUE, closed_at = NOW()
        WHERE guild_id = $1 AND channel_id = $2
        `,
        [guildId, channelId],
      );

      // Get ticket data
      const ticketData = await this.getTicketData(guildId, channelId);
      if (!ticketData) {
        await dbClient.query('ROLLBACK');
        return {
          success: false,
          error: 'Ticket not found',
        };
      }

      // Get channel first (needed for both empty and regular tickets)
      const guild = await client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(channelId);

      if (!channel?.isTextBased()) {
        await dbClient.query('ROLLBACK');
        return {
          success: false,
          error: 'Channel not found or not text-based',
        };
      }

      // If no owner or no playertags, just close the ticket without linking
      if (!ticketData.createdBy || ticketData.playertags.length === 0) {
        await dbClient.query('COMMIT');

        logger.info(`Closed empty ticket in guild ${guildId}, channel ${channelId}`);

        // Send message in channel
        await channel.send({
          content: '✅ Ticket has been closed. No accounts were linked because no playertags were entered.',
        });

        // Send log
        await this.sendLog(
          client,
          guildId,
          '📪 Ticket Closed',
          `An empty ticket <#${channelId}> was closed (no playertags were entered).`,
        );

        return {
          success: true,
          embeds: [],
        };
      }

      // Get user avatar
      let avatarUrl: string | undefined;
      try {
        const user = await guild.members.fetch(ticketData.createdBy);
        avatarUrl = user.displayAvatarURL();
      } catch {
        try {
          const user = await client.users.fetch(ticketData.createdBy);
          avatarUrl = user.displayAvatarURL();
        } catch {
          avatarUrl = undefined;
        }
      }

      // Get max_player_links from link_settings
      const maxLinkRes = await dbClient.query(`SELECT max_player_links FROM link_settings WHERE guild_id = $1`, [
        guildId,
      ]);
      const maxLinks = maxLinkRes.rows[0]?.max_player_links ?? 10;

      // Check how many accounts the user already has linked
      const userLinkCountRes = await dbClient.query(
        `SELECT COUNT(*)::int AS link_count FROM user_playertags WHERE guild_id = $1 AND discord_id = $2`,
        [guildId, ticketData.createdBy],
      );
      const currentUserLinkCount = userLinkCountRes.rows[0]?.link_count ?? 0;
      const availableSlots = maxLinks - currentUserLinkCount;

      // Auto-link playertags up to the max limit
      const embeds: EmbedBuilder[] = [];
      const tagsToLink = ticketData.playertags.slice(0, availableSlots);
      const tagsExceedingLimit = ticketData.playertags.slice(availableSlots);
      const newLinks: string[] = [];
      const relinksNeeded: string[] = [];
      const alreadyLinked: string[] = [];
      const errors: string[] = [];

      await channel.send({
        content: `Ticket identified as closed, linking playertags to <@${ticketData.createdBy}>. Links shown below.`,
        embeds: [],
      });
      for (const playertag of tagsToLink) {
        const { embed, components } = await linkUser(dbClient, guildId, ticketData.createdBy, playertag);

        if (components && components.length > 0) {
          const rawComponents = components.map((c) => c.toJSON());
          await channel.send({ embeds: [embed], components: rawComponents });
          relinksNeeded.push(`\`${playertag}\` — ${embed.data.description ?? 'Conflict'}`);
        } else {
          const oldFooter = embed.data.footer?.text ?? '';
          if (oldFooter.length > 1) {
            embed.setFooter({ text: oldFooter, iconURL: avatarUrl });
          }
          await channel.send({ embeds: [embed] });

          if (embed.data.footer?.text?.includes('New Link')) {
            newLinks.push(`\`${playertag}\``);
          } else if (embed.data.description?.includes('already linked')) {
            alreadyLinked.push(`\`${playertag}\``);
          } else if (embed.data.description?.includes('Failed') || embed.data.description?.includes('issue')) {
            errors.push(`\`${playertag}\` — ${embed.data.description ?? 'Error'}`);
          } else {
            newLinks.push(`\`${playertag}\``);
          }
        }

        embeds.push(embed);
      }

      // If some tags couldn't be linked due to max limit, send a message
      if (tagsExceedingLimit.length > 0) {
        const limitEmbed = new EmbedBuilder()
          .setDescription(
            `⚠️ Could not link the following playertags because <@${ticketData.createdBy}> has reached the maximum of **${maxLinks}** linked accounts:\n\n${tagsExceedingLimit.map((tag) => `\`${tag}\``).join(', ')}`,
          )
          .setColor(0xffa500);
        await channel.send({ embeds: [limitEmbed] });
      }

      await dbClient.query('COMMIT');

      logger.info(`Closed ticket and auto-linked ${ticketData.playertags.length} accounts in guild ${guildId}`);

      if (newLinks.length > 0) {
        StatsTracker.increment(guildId, 'total_tickets_with_playertags_linked').catch(() => {});
        StatsTracker.increment(guildId, 'total_playertags_linked_from_tickets', newLinks.length).catch(() => {});
      }

      const logParts: string[] = [`The ticket for <@${ticketData.createdBy}> has been closed.`];
      if (newLinks.length > 0) {
        logParts.push(`\n**✅ New Links:**\n${newLinks.join('\n')}`);
      }
      if (relinksNeeded.length > 0) {
        logParts.push(`\n**⚠️ Relink Needed:**\n${relinksNeeded.join('\n')}`);
      }
      if (alreadyLinked.length > 0) {
        logParts.push(`\n**Already Linked:**\n${alreadyLinked.join('\n')}`);
      }
      if (tagsExceedingLimit.length > 0) {
        logParts.push(
          `\n**❌ Not Linked (max ${maxLinks} reached):**\n${tagsExceedingLimit.map((t) => `\`${t}\``).join('\n')}`,
        );
      }
      if (errors.length > 0) {
        logParts.push(`\n**Errors:**\n${errors.join('\n')}`);
      }

      await ticketService.sendLog(client, guildId, '📪 Ticket Closed', logParts.join('\n'));
      return {
        success: true,
        embeds,
      };
    } catch (error) {
      await dbClient.query('ROLLBACK');
      logger.error('Error closing ticket:', error);
      return {
        success: false,
        error: 'Failed to close ticket',
      };
    } finally {
      dbClient.release();
    }
  }

  /**
   * Close a ticket when its channel is deleted - links tags and sends detailed log
   */
  async closeTicketOnDeletion(params: CloseTicketParams & { channelName: string }): Promise<TicketResponse> {
    const { guildId, channelId, client, channelName } = params;

    const dbClient = await pool.connect();

    try {
      await dbClient.query('BEGIN');

      await dbClient.query(
        `UPDATE tickets SET is_closed = TRUE, closed_at = NOW() WHERE guild_id = $1 AND channel_id = $2`,
        [guildId, channelId],
      );

      const ticketData = await this.getTicketData(guildId, channelId);
      if (!ticketData) {
        await dbClient.query('ROLLBACK');
        return { success: false, error: 'Ticket not found' };
      }

      if (!ticketData.createdBy || ticketData.playertags.length === 0) {
        await dbClient.query('COMMIT');
        logger.info(`Closed empty ticket (channel deleted) in guild ${guildId}, channel ${channelId}`);
        await this.sendLog(
          client,
          guildId,
          '🗑️ Ticket Closed (Channel Deleted)',
          `An empty ticket **${channelName}** was deleted (no playertags were entered).`,
        );
        return { success: true, embeds: [] };
      }

      const maxLinkRes = await dbClient.query(`SELECT max_player_links FROM link_settings WHERE guild_id = $1`, [
        guildId,
      ]);
      const maxLinks = maxLinkRes.rows[0]?.max_player_links ?? 10;

      const userLinkCountRes = await dbClient.query(
        `SELECT COUNT(*)::int AS link_count FROM user_playertags WHERE guild_id = $1 AND discord_id = $2`,
        [guildId, ticketData.createdBy],
      );
      const currentUserLinkCount = userLinkCountRes.rows[0]?.link_count ?? 0;
      const availableSlots = maxLinks - currentUserLinkCount;

      const tagsToLink = ticketData.playertags.slice(0, availableSlots);
      const tagsExceedingLimit = ticketData.playertags.slice(availableSlots);

      const newLinks: string[] = [];
      const relinksNeeded: string[] = [];
      const alreadyLinked: string[] = [];
      const errors: string[] = [];

      for (const playertag of tagsToLink) {
        const { embed, components } = await linkUser(dbClient, guildId, ticketData.createdBy, playertag);

        if (components && components.length > 0) {
          relinksNeeded.push(`\`${playertag}\` — ${embed.data.description ?? 'Conflict'}`);
        } else if (embed.data.footer?.text?.includes('New Link')) {
          newLinks.push(`\`${playertag}\``);
        } else if (embed.data.description?.includes('already linked')) {
          alreadyLinked.push(`\`${playertag}\``);
        } else if (embed.data.description?.includes('Failed') || embed.data.description?.includes('issue')) {
          errors.push(`\`${playertag}\` — ${embed.data.description ?? 'Error'}`);
        } else {
          newLinks.push(`\`${playertag}\``);
        }
      }

      await dbClient.query('COMMIT');

      if (tagsToLink.length > 0) {
        StatsTracker.increment(guildId, 'total_tickets_with_playertags_linked').catch(() => {});
        StatsTracker.increment(guildId, 'total_playertags_linked_from_tickets', newLinks.length).catch(() => {});
      }

      const logParts: string[] = [
        `Ticket **${channelName}** for <@${ticketData.createdBy}> was closed (channel deleted).`,
      ];

      if (newLinks.length > 0) {
        logParts.push(`\n**✅ New Links:**\n${newLinks.join('\n')}`);
      }
      if (relinksNeeded.length > 0) {
        logParts.push(`\n**⚠️ Relink Needed:**\n${relinksNeeded.join('\n')}`);
      }
      if (alreadyLinked.length > 0) {
        logParts.push(`\n**Already Linked:**\n${alreadyLinked.join('\n')}`);
      }
      if (tagsExceedingLimit.length > 0) {
        logParts.push(
          `\n**❌ Not Linked (max ${maxLinks} reached):**\n${tagsExceedingLimit.map((t) => `\`${t}\``).join('\n')}`,
        );
      }
      if (errors.length > 0) {
        logParts.push(`\n**Errors:**\n${errors.join('\n')}`);
      }

      await this.sendLog(client, guildId, '🗑️ Ticket Closed (Channel Deleted)', logParts.join('\n'));

      logger.info(
        `Closed ticket (channel deleted) in guild ${guildId}: ${newLinks.length} new, ${relinksNeeded.length} relinks needed, ${alreadyLinked.length} already linked`,
      );

      return { success: true };
    } catch (error) {
      await dbClient.query('ROLLBACK');
      logger.error('Error closing ticket on channel deletion:', error);
      return { success: false, error: 'Failed to close ticket' };
    } finally {
      dbClient.release();
    }
  }

  /**
   * Reopen a ticket
   */
  async reopenTicket(guildId: string, channelId: string): Promise<TicketResponse> {
    try {
      await pool.query(
        `
        UPDATE tickets
        SET is_closed = FALSE, closed_at = null
        WHERE guild_id = $1 AND channel_id = $2
        `,
        [guildId, channelId],
      );

      logger.info(`Reopened ticket in guild ${guildId}, channel ${channelId}`);

      return { success: true };
    } catch (error) {
      logger.error('Error reopening ticket:', error);
      return {
        success: false,
        error: 'Failed to reopen ticket',
      };
    }
  }

  /**
   * Create a new ticket record in the database
   */
  async createTicket(guildId: string, channelId: string, channelName: string): Promise<TicketResponse> {
    try {
      // Check if ticket already exists (in case of race condition)
      const existing = await pool.query(`SELECT channel_id FROM tickets WHERE guild_id = $1 AND channel_id = $2`, [
        guildId,
        channelId,
      ]);

      if (existing.rows.length > 0) {
        return { success: true };
      }

      // Insert new ticket with initial channel name, no owner yet
      await pool.query(
        `
        INSERT INTO tickets (guild_id, channel_id, initial_ticket_name)
        VALUES ($1, $2, $3)
        `,
        [guildId, channelId, channelName],
      );

      logger.info(`Created new ticket for guild ${guildId}, channel ${channelId}`);

      return { success: true };
    } catch (error) {
      logger.error('Error creating ticket:', error);
      return {
        success: false,
        error: 'Failed to create ticket',
      };
    }
  }

  /**
   * Check if channel name matches ticket identifier
   */
  isTicketChannel(channelName: string, identifier: string): boolean {
    return channelName.includes(identifier);
  }
}

// Singleton instance
export const ticketService = new TicketService();
