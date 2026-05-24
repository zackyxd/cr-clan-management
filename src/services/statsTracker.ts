/**
 * Bot Statistics Tracker Service
 *
 * Tracks activity metrics across all bot features for analytics and "fun numbers"
 */

import { pool } from '../db.js';
import logger from '../logger.js';

export type StatisticMetric =
  // Member Channels
  | 'total_member_channels_created'
  | 'total_member_channels_deleted'
  // Tickets & Linking
  | 'total_tickets_with_playertags_linked'
  | 'total_playertags_linked_from_tickets'
  // Nudges
  | 'total_nudges_sent'
  // Invites
  | 'total_invite_messages_sent'
  // Interaction Analytics
  | 'total_commands_used'
  | 'total_buttons_clicked'
  | 'total_modals_submitted';

export interface BotStatistics {
  guild_id: string;
  // Member Channels
  total_member_channels_created: number;
  total_member_channels_deleted: number;
  // Tickets & Linking
  total_tickets_with_playertags_linked: number;
  total_playertags_linked_from_tickets: number;
  // Nudges
  total_nudges_sent: number;
  // Invites
  total_invite_messages_sent: number;
  // Interaction Analytics
  total_commands_used: number;
  total_buttons_clicked: number;
  total_modals_submitted: number;
  // Timestamps
  created_at: Date;
  updated_at: Date;
}

export class StatsTracker {
  /**
   * Increment a statistic counter
   *
   * Uses UPSERT to handle first-time tracking and updates
   * Errors are logged but don't throw to avoid breaking operations
   *
   * @param guildId - Discord server ID
   * @param metric - Metric name to increment
   * @param amount - Amount to increment by (default: 1)
   */
  static async increment(guildId: string, metric: StatisticMetric, amount: number = 1): Promise<void> {
    try {
      await pool.query(
        `
        INSERT INTO bot_statistics (guild_id, ${metric}, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (guild_id)
        DO UPDATE SET
          ${metric} = bot_statistics.${metric} + $2,
          updated_at = NOW()
        `,
        [guildId, amount],
      );
    } catch (error) {
      logger.error(`[StatsTracker] Failed to increment ${metric} for guild ${guildId}:`, error);
    }
  }

  /**
   * Get all statistics for a guild
   *
   * @param guildId - Discord server ID
   * @returns Statistics object or null if not found
   */
  static async get(guildId: string): Promise<BotStatistics | null> {
    try {
      const result = await pool.query<BotStatistics>(
        `
        SELECT * FROM bot_statistics WHERE guild_id = $1
        `,
        [guildId],
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error(`[StatsTracker] Failed to get statistics for guild ${guildId}:`, error);
      return null;
    }
  }

  /**
   * Get a specific metric value for a guild
   *
   * @param guildId - Discord server ID
   * @param metric - Metric name to retrieve
   * @returns Metric value or 0 if not found
   */
  static async getMetric(guildId: string, metric: StatisticMetric): Promise<number> {
    try {
      const result = await pool.query<Record<string, number>>(
        `
        SELECT ${metric} FROM bot_statistics WHERE guild_id = $1
        `,
        [guildId],
      );

      return result.rows[0]?.[metric] || 0;
    } catch (error) {
      logger.error(`[StatsTracker] Failed to get ${metric} for guild ${guildId}:`, error);
      return 0;
    }
  }

  /**
   * Initialize statistics for a new guild
   *
   * Called when bot joins a server to ensure row exists
   *
   * @param guildId - Discord server ID
   */
  static async initialize(guildId: string): Promise<void> {
    try {
      await pool.query(
        `
        INSERT INTO bot_statistics (guild_id)
        VALUES ($1)
        ON CONFLICT (guild_id) DO NOTHING
        `,
        [guildId],
      );
    } catch (error) {
      logger.error(`[StatsTracker] Failed to initialize statistics for guild ${guildId}:`, error);
    }
  }
}
