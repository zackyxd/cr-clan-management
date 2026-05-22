/**
 * Daily Reset Scheduler
 *
 * Resets user flags (is_attacking_late, is_replace_me) at 9:00 AM UTC daily.
 * This runs at the same time as war day rollover to prepare for the new day.
 */

import { Client } from 'discord.js';
import { pool } from '../../db.js';
import logger from '../../logger.js';
import cron from 'node-cron';

export class DailyResetScheduler {
  private task: cron.ScheduledTask | null = null;
  private readonly RESET_HOUR = 9; // 9:00 AM UTC (war day end/start time)
  private readonly RESET_MINUTE = 0;
  private lastResetDate: string | null = null; // Track last reset date (YYYY-MM-DD)

  constructor(private client: Client) {
    logger.info('Daily reset scheduler initialized');
  }

  async start() {
    if (this.task) return;

    // Check if reset was missed during downtime (on startup)
    await this.checkMissedReset();

    // Run daily at 9:00 AM UTC (when war days reset)
    // Cron pattern: minute hour * * * (minute hour day month weekday)
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
   * Check if the daily reset was missed (e.g., bot was down at 9:00 AM UTC).
   * If current time is past reset time and flags are still set, run reset immediately.
   */
  private async checkMissedReset(): Promise<void> {
    try {
      const now = new Date();
      const currentHourUTC = now.getUTCHours();
      const currentMinuteUTC = now.getUTCMinutes();
      const todayDate = now.toISOString().split('T')[0]; // YYYY-MM-DD

      // Calculate minutes since reset time today
      const resetTimeMinutes = this.RESET_HOUR * 60 + this.RESET_MINUTE;
      const currentTimeMinutes = currentHourUTC * 60 + currentMinuteUTC;

      // Only check if we're past the reset time today
      if (currentTimeMinutes < resetTimeMinutes) {
        logger.info('[Daily Reset] Startup check: before reset time today, no action needed');
        return;
      }

      // Check if any users still have flags set (indicates missed reset)
      const checkResult = await pool.query(
        `
        SELECT COUNT(*) as count
        FROM users
        WHERE is_attacking_late = true 
           OR is_replace_me = true
           OR is_replace_me_message_id IS NOT NULL
        `,
      );

      const flaggedCount = parseInt(checkResult.rows[0]?.count || '0', 10);

      if (flaggedCount > 0) {
        logger.warn(
          `[Daily Reset] 🔧 Missed reset detected! Bot was likely down at reset time. ` +
            `Found ${flaggedCount} user(s) with flags still set. Running reset now...`,
        );
        await this.performDailyReset();
      } else {
        logger.info('[Daily Reset] Startup check: reset already completed today');
        this.lastResetDate = todayDate;
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
   * Perform daily reset of user flags.
   * Resets is_attacking_late and is_replace_me to false for all users.
   */
  private async performDailyReset() {
    try {
      const now = new Date();
      const todayDate = now.toISOString().split('T')[0]; // YYYY-MM-DD

      // Prevent duplicate resets on the same day
      if (this.lastResetDate === todayDate) {
        logger.info('[Daily Reset] Already ran today, skipping');
        return;
      }

      logger.info('[Daily Reset] Starting daily user flag reset...');

      const result = await pool.query(
        `
        UPDATE users
        SET 
          is_attacking_late = false,
          is_replace_me = false,
          is_replace_me_message_id = null
        WHERE is_attacking_late = true 
           OR is_replace_me = true
           OR is_replace_me_message_id IS NOT NULL
        `,
      );

      const resetCount = result.rowCount || 0;

      // Mark that we've run the reset for today
      this.lastResetDate = todayDate;

      if (resetCount > 0) {
        logger.info(`[Daily Reset] ✅ Reset ${resetCount} user flag(s) (is_attacking_late, is_replace_me)`);
      } else {
        logger.info('[Daily Reset] ✅ No user flags needed resetting');
      }
    } catch (error) {
      logger.error('[Daily Reset] ❌ Error during daily reset:', error);
    }
  }

  /**
   * Manually trigger a reset (for testing or manual intervention).
   * Can be called from a command if needed.
   */
  async manualReset(): Promise<number> {
    logger.info('[Daily Reset] Manual reset triggered');

    const result = await pool.query(
      `
      UPDATE users
      SET 
        is_attacking_late = false,
        is_replace_me = false,
        is_replace_me_message_id = null
      WHERE is_attacking_late = true 
         OR is_replace_me = true
         OR is_replace_me_message_id IS NOT NULL
      `,
    );

    const resetCount = result.rowCount || 0;
    logger.info(`[Daily Reset] Manual reset complete - ${resetCount} user(s) reset`);

    return resetCount;
  }
}
