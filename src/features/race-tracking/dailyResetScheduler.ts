/**
 * Daily Reset Scheduler
 *
 * Resets user flags (is_attacking_late, is_replace_me) at 9:00 AM UTC daily.
 * This runs at the same time as war day rollover to prepare for the new day.
 *
 * Uses server_settings.last_daily_reset per guild to persist reset timestamps
 * across restarts. On startup, resets any guild whose last reset was >= 23.8 hours ago.
 */

import { Client } from 'discord.js';
import { pool } from '../../db.js';
import logger from '../../logger.js';
import cron from 'node-cron';

const RESET_THRESHOLD_MS = 23.8 * 60 * 60 * 1000; // 23.8 hours in ms

export class DailyResetScheduler {
  private task: cron.ScheduledTask | null = null;
  private readonly RESET_HOUR = 9; // 9:00 AM UTC (war day end/start time)
  private readonly RESET_MINUTE = 0;

  constructor(private client: Client) {
    logger.info('Daily reset scheduler initialized');
  }

  async start() {
    if (this.task) return;

    await this.checkMissedReset();

    const cronPattern = `${this.RESET_MINUTE} ${this.RESET_HOUR} * * *`;

    this.task = cron.schedule(
      cronPattern,
      () => {
        this.performDailyReset();
      },
      {
        timezone: 'Etc/UTC',
      },
    );

    logger.info(
      `🔄 Daily reset scheduler started - runs daily at ${String(this.RESET_HOUR).padStart(2, '0')}:${String(this.RESET_MINUTE).padStart(2, '0')} UTC`,
    );
  }

  /**
   * On startup, check each guild's last_daily_reset.
   * If null or >= 23.8 hours ago, reset that guild's user flags.
   */
  private async checkMissedReset(): Promise<void> {
    try {
      const now = new Date();

      const guildsResult = await pool.query(
        `SELECT guild_id, last_daily_reset FROM server_settings`,
      );

      for (const row of guildsResult.rows) {
        const { guild_id, last_daily_reset } = row;
        const lastReset = last_daily_reset ? new Date(last_daily_reset) : null;
        const timeSinceReset = lastReset ? now.getTime() - lastReset.getTime() : Infinity;

        if (timeSinceReset >= RESET_THRESHOLD_MS) {
          logger.warn(
            `[Daily Reset] Guild ${guild_id}: last reset ${lastReset ? lastReset.toISOString() : 'never'} ` +
              `(${lastReset ? Math.round(timeSinceReset / 3600000) + 'h ago' : 'N/A'}). Resetting now...`,
          );
          await this.resetGuild(guild_id);
        } else {
          logger.info(
            `[Daily Reset] Guild ${guild_id}: last reset ${Math.round(timeSinceReset / 3600000)}h ago, no action needed`,
          );
        }
      }
    } catch (error) {
      logger.error('[Daily Reset] Error checking for missed reset:', error);
    }
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info('Stopped daily reset scheduler');
    }
  }

  /**
   * Reset user flags for a single guild and update its last_daily_reset timestamp.
   */
  private async resetGuild(guildId: string): Promise<number> {
    const result = await pool.query(
      `UPDATE users
       SET is_attacking_late = false,
           is_replace_me = false,
           is_replace_me_message_id = null,
           replace_me_ping_sent_today = false,
           attacking_late_ping_sent_today = false
       WHERE guild_id = $1
         AND (is_attacking_late = true
           OR is_replace_me = true
           OR is_replace_me_message_id IS NOT NULL
           OR replace_me_ping_sent_today = true
           OR attacking_late_ping_sent_today = true)`,
      [guildId],
    );

    const resetCount = result.rowCount || 0;

    await pool.query(
      `UPDATE server_settings SET last_daily_reset = NOW() WHERE guild_id = $1`,
      [guildId],
    );

    if (resetCount > 0) {
      logger.info(`[Daily Reset] Guild ${guildId}: reset ${resetCount} user flag(s)`);
    }

    return resetCount;
  }

  /**
   * Cron-triggered reset: reset all guilds.
   */
  private async performDailyReset() {
    try {
      logger.info('[Daily Reset] Starting daily user flag reset...');

      const guildsResult = await pool.query(
        `SELECT guild_id FROM server_settings`,
      );

      let totalReset = 0;
      for (const row of guildsResult.rows) {
        totalReset += await this.resetGuild(row.guild_id);
      }

      if (totalReset > 0) {
        logger.info(`[Daily Reset] ✅ Reset ${totalReset} user flag(s) across ${guildsResult.rows.length} guild(s)`);
      } else {
        logger.info('[Daily Reset] ✅ No user flags needed resetting');
      }
    } catch (error) {
      logger.error('[Daily Reset] ❌ Error during daily reset:', error);
    }
  }

  /**
   * Manually trigger a reset for all guilds.
   */
  async manualReset(): Promise<number> {
    logger.info('[Daily Reset] Manual reset triggered');

    const guildsResult = await pool.query(
      `SELECT guild_id FROM server_settings`,
    );

    let totalReset = 0;
    for (const row of guildsResult.rows) {
      totalReset += await this.resetGuild(row.guild_id);
    }

    logger.info(`[Daily Reset] Manual reset complete - ${totalReset} user(s) reset`);
    return totalReset;
  }
}
