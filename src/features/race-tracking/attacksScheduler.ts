/**
 *
 * Attacks Scheduler
 * Check all attacks of all clans to keep updated data.
 * Runs every 3 minutes for all clans.
 *
 */

import { Client } from 'discord.js';
import { pool } from '../../db.js';
import logger from '../../logger.js';
import { initializeOrUpdateRace } from './service.js';
import cron from 'node-cron';

export class AttacksTrackingScheduler {
  private task: cron.ScheduledTask | null = null;

  constructor(private client: Client) {
    logger.info('Race update scheduler initialized');
  }

  start() {
    if (this.task) return;

    // Run every 2 minutes
    this.task = cron.schedule(
      '*/2 * * * *',
      () => {
        this.checkAllClansAttacks();
      },
      {
        timezone: 'Etc/UTC',
      },
    );

    const now = new Date();
    const nextRun = new Date(now);
    // Calculate next 2-minute boundary
    const currentMinutes = nextRun.getUTCMinutes();
    const nextMinutes = Math.ceil(currentMinutes / 3) * 3;
    if (nextMinutes >= 60) {
      nextRun.setUTCHours(nextRun.getUTCHours() + 1);
      nextRun.setUTCMinutes(0);
    } else {
      nextRun.setUTCMinutes(nextMinutes);
    }
    nextRun.setUTCSeconds(0);
    nextRun.setUTCMilliseconds(0);

    logger.info(
      `⚡ Race update scheduler started - runs every 2 minutes (next: ${String(nextRun.getUTCHours()).padStart(2, '0')}:${String(nextRun.getUTCMinutes()).padStart(2, '0')}:${String(nextRun.getUTCSeconds()).padStart(2, '0')})`,
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
    }
  }
}
