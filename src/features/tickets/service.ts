import { pool } from '../../db.js';
import { CR_API, FetchError } from '../../api/CR_API.js';
import { formatPlayerData } from '../../api/FORMAT_DATA.js';
import { linkUser } from '../../services/users.js';
import logger from '../../logger.js';
import type { EmbedBuilder } from 'discord.js';
import type {
  TicketResponse,
  AddPlayertagsParams,
  UpdateIdentifierParams,
  CloseTicketParams,
  TicketFeatureCheck,
  TicketData,
} from './types.js';

/**
 * Core service class for managing ticket functionality
 * Handles all business logic for ticket operations
 */
export class TicketService {
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

      console.log(rows[0], userId);
      // Check if ticket exists and if user is the creator
      if (rows.length > 0 && rows[0].created_by !== userId) {
        logger.warn(`User ${userId} attempted to add tags to ticket created by ${rows[0].created_by}`);
        return {
          success: false,
          error: 'Someone has already uploaded their playertags to this ticket. Please make your own ticket.',
        };
      }

      const currentTags: string[] = rows[0]?.playertags ?? [];
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
        await pool.query(
          `
          INSERT INTO tickets (guild_id, channel_id, playertags, created_by)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (guild_id, channel_id)
          DO UPDATE SET playertags = (
            SELECT ARRAY(
              SELECT DISTINCT unnest(t.playertags || EXCLUDED.playertags)
              ORDER BY 1
            )
            FROM tickets t
            WHERE t.guild_id = EXCLUDED.guild_id
              AND t.channel_id = EXCLUDED.channel_id
            )
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
   * Update ticket identifier (opened or closed)
   */
  async updateIdentifier(params: UpdateIdentifierParams): Promise<TicketResponse> {
    const { guildId, settingKey, value } = params;

    try {
      await pool.query(`UPDATE ticket_settings SET ${settingKey} = $1 WHERE guild_id = $2`, [
        value.toLowerCase(),
        guildId,
      ]);

      logger.info(`Updated ${settingKey} to '${value}' for guild ${guildId}`);

      return { success: true };
    } catch (error) {
      logger.error(`Error updating ${settingKey}:`, error);
      return {
        success: false,
        error: `Failed to update ${settingKey}`,
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

      // Get channel
      const guild = await client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(channelId);

      if (!channel?.isTextBased()) {
        await dbClient.query('ROLLBACK');
        return {
          success: false,
          error: 'Channel not found or not text-based',
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

      // Auto-link all playertags
      const embeds: EmbedBuilder[] = [];
      for (const playertag of ticketData.playertags) {
        const { embed, components } = await linkUser(dbClient, guildId, ticketData.createdBy, playertag);

        if (components && components.length > 0) {
          // Convert builder instances to raw JSON data for Discord API
          const rawComponents = components.map((c) => c.toJSON());
          await channel.send({ embeds: [embed], components: rawComponents });
        } else {
          const oldFooter = embed.data.footer?.text ?? '';
          if (oldFooter.length > 1) {
            embed.setFooter({ text: oldFooter, iconURL: avatarUrl });
          }
          await channel.send({ embeds: [embed] });
        }

        embeds.push(embed);
      }

      await dbClient.query('COMMIT');

      logger.info(`Closed ticket and auto-linked ${ticketData.playertags.length} accounts in guild ${guildId}`);

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
   * Reopen a ticket
   */
  async reopenTicket(guildId: string, channelId: string): Promise<TicketResponse> {
    try {
      await pool.query(
        `
        UPDATE tickets
        SET is_closed = FALSE, closed_at = NOW()
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
   * Check if channel name matches ticket identifier
   */
  isTicketChannel(channelName: string, identifier: string): boolean {
    return channelName.includes(identifier);
  }
}

// Singleton instance
export const ticketService = new TicketService();
