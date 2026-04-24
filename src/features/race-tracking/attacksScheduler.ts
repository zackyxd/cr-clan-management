/**
 *
 * Attacks Scheduler
 * Check all attacks of all clans to keep updated data.
 * Runs every 1 minute for all clans.
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
      `⚡ Race update scheduler started - runs every 1 minute at :00 seconds UTC (next: ${String(nextRun.getUTCHours()).padStart(2, '0')}:${String(nextRun.getUTCMinutes()).padStart(2, '0')}:00)`,
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
      // Get unique clantags to avoid duplicate API calls
      // Use MIN(guild_id) to pick one guild per clan for participant tracking
      const result = await pool.query(
        `
        SELECT 
          MIN(guild_id) as guild_id,
          clantag,
          MAX(clan_name) as clan_name,
          array_agg(DISTINCT guild_id) as tracking_guilds
        FROM clans
        GROUP BY clantag
        ORDER BY clantag
        `,
      );

      const clans = result.rows;
      // logger.info(`Checking attacks for ${clans.length} unique clan(s)`);

      for (const clan of clans) {
        try {
          // Update race data once per clan (shared across guilds)
          const updateResult = await initializeOrUpdateRace(clan.clantag);
          if (updateResult) {
            const guildsTracking =
              clan.tracking_guilds.length > 1 ? ` (tracked by ${clan.tracking_guilds.length} guilds)` : '';
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
    } catch (error) {
      logger.error('Error while checking all clans attacks', error);
    } finally {
      this.isRunning = false;
    }
  }
}
