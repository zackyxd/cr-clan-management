/**
 *
 * Attacks Scheduler
 * Check all attacks of all clans to keep updated data.
 * Runs every 1 minute for war/colosseum days, every 5 minutes for training days.
 *
 */

import { Client } from 'discord.js';
import { pool } from '../../db.js';
import logger from '../../logger.js';
import { initializeOrUpdateRace } from './service.js';
import cron from 'node-cron';

export class AttacksTrackingScheduler {
  private task: cron.ScheduledTask | null = null;
  private isRunning = false;
  private readonly TRAINING_DAY_INTERVAL_MINUTES = 5; // Update training day clans every 5 minutes

  constructor(private client: Client) {
    logger.info('Race update scheduler initialized');
  }

  start() {
    if (this.task) return;

    // Run every 1 minute
    this.task = cron.schedule(
      '* * * * *',
      () => {
        this.checkAllClansAttacks();
      },
      {
        timezone: 'Etc/UTC',
      },
    );

    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setUTCMinutes(nextRun.getUTCMinutes() + 1);
    nextRun.setUTCSeconds(0);
    nextRun.setUTCMilliseconds(0);

    logger.info(
      `⚡ Race update scheduler started - runs every 1 minute (training days: every ${this.TRAINING_DAY_INTERVAL_MINUTES} min) at :00 seconds UTC (next: ${String(nextRun.getUTCHours()).padStart(2, '0')}:${String(nextRun.getUTCMinutes()).padStart(2, '0')}:00)`,
    );
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info('Stopped race update scheduler');
    }
  }

  private async checkAllClansAttacks() {
    if (this.isRunning) {
      logger.warn('Previous race update still running, skipping this cycle');
      return;
    }

    this.isRunning = true;
    try {
      const now = new Date();

      // Get unique clantags with their current race state and last check time
      const result = await pool.query(
        `
        SELECT 
          MIN(c.guild_id) as guild_id,
          c.clantag,
          MAX(c.clan_name) as clan_name,
          array_agg(DISTINCT c.guild_id) as tracking_guilds,
          MAX(rr.race_state) as race_state,
          MAX(rr.last_check) as last_check
        FROM clans c
        LEFT JOIN river_races rr ON c.clantag = rr.clantag 
          AND rr.current_week = (SELECT MAX(current_week) FROM river_races WHERE clantag = c.clantag)
        GROUP BY c.clantag
        ORDER BY c.clantag
        `,
      );

      const clans = result.rows;
      let skippedCount = 0;
      let updatedCount = 0;

      for (const clan of clans) {
        try {
          // Skip training day clans if they were checked recently
          if (clan.race_state === 'training' && clan.last_check) {
            const lastCheck = new Date(clan.last_check);
            const minutesSinceLastCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60);
            
            if (minutesSinceLastCheck < this.TRAINING_DAY_INTERVAL_MINUTES) {
              skippedCount++;
              continue; // Skip this clan
            }
          }

          // Update race data once per clan (shared across guilds)
          const updateResult = await initializeOrUpdateRace(clan.clantag);
          if (updateResult) {
            updatedCount++;
            // const guildsTracking =
            //   clan.tracking_guilds.length > 1 ? ` (tracked by ${clan.tracking_guilds.length} guilds)` : '';
            // logger.info(
            //   `Updated race for ${clan.clan_name} (${clan.clantag}): Day ${updateResult.warDay}, Week ${updateResult.warWeek}${guildsTracking}`,
            // );
          } else {
            logger.warn(`Failed to update race for ${clan.clan_name} (${clan.clantag})`);
          }
        } catch (error) {
          logger.error(`Error updating race for ${clan.clan_name} (${clan.clantag}):`, error);
        }
      }

      if (skippedCount > 0) {
        logger.info(`Race update: ${updatedCount} updated, ${skippedCount} training day clans skipped (checked <${this.TRAINING_DAY_INTERVAL_MINUTES}m ago)`);
      }
    } catch (error) {
      logger.error('Error while checking all clans attacks', error);
    } finally {
      this.isRunning = false;
    }
  }
}
