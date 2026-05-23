/**
 * Clan Activity Scheduler
 *
 * Runs every minute and checks clans for activity changes.
 * Uses distributed scheduling to spread API calls evenly over time.
 *
 * Algorithm:
 * - Every minute, fetch N clans that are due for checking
 * - Check each clan and update their last_activity_check_at
 * - With proper N value, all clans are checked approximately every 3 minutes
 */

import cron from 'node-cron';
import { Client } from 'discord.js';
import { pool } from '../../db.js';
import { buildGetClansForActivityCheck } from '../../sql_queries/clans.js';
import { checkClanActivity } from './service.js';
import logger from '../../logger.js';
import type { ClanActivityData } from './types.js';

// Prevent concurrent checks of the same clan
const checkingClans = new Set<string>();

/**
 * Start the clan activity scheduler
 * Runs every minute to check a batch of clans
 *
 * @param client - Discord client instance
 */
export function startClanActivityScheduler(client: Client): void {
  // Run every minute at the start of the minute
  cron.schedule('0 * * * * *', async () => {
    try {
      await checkClanActivityBatch(client);
    } catch (error) {
      logger.error('[ClanActivityScheduler] Error in scheduled check:', error);
    }
  });

  logger.info('[ClanActivityScheduler] Clan activity scheduler started (runs every minute)');
}

/**
 * Check a batch of clans that are due for checking
 *
 * Target: Check each clan approximately every 3 minutes
 * With ~60 clans and 20 per batch, all clans checked in 3 batches = 3 minutes
 */
async function checkClanActivityBatch(client: Client): Promise<void> {
  try {
    // Get clans that need checking (ordered by oldest check first)
    const query = buildGetClansForActivityCheck(20); // Check 20 clans per minute
    const result = await pool.query<ClanActivityData>(query);

    if (result.rows.length === 0) {
      logger.debug('[ClanActivityScheduler] No clans to check this minute');
      return;
    }

    // Check each clan
    const checkPromises = result.rows.map(async (clanData) => {
      const clanKey = `${clanData.guild_id}:${clanData.clantag}`;

      // Skip if already checking
      if (checkingClans.has(clanKey)) {
        logger.debug(`[ClanActivityScheduler] Skipping ${clanData.clantag} (already checking)`);
        return;
      }

      // Mark as checking
      checkingClans.add(clanKey);

      try {
        await checkClanActivity(client, clanData);
      } finally {
        // Remove from checking set
        checkingClans.delete(clanKey);
      }
    });

    // Wait for all checks to complete
    await Promise.all(checkPromises);

    logger.debug(`[ClanActivityScheduler] Completed checking ${result.rows.length} clans`);
  } catch (error) {
    logger.error('[ClanActivityScheduler] Error checking clan batch:', error);
  }
}
