/**
 * Clan Activity Service
 *
 * Orchestrates clan activity checking:
 * - Fetches clan data from API
 * - Detects changes using comparator
 * - Formats and sends logs
 * - Manages Discord roles
 * - Updates database snapshots
 */

import { Client, TextChannel, User } from 'discord.js';
import { pool } from '../../db.js';
import { detectClanChanges } from './comparator.js';
import { formatClanChange } from './formatter.js';
import { handleRoleChanges } from './roleManager.js';
import { buildUpdateActivitySnapshot } from '../../sql_queries/clans.js';
import logger from '../../logger.js';
import type { ClanActivityData, ClanChange } from './types.js';
import { CR_API, isFetchError, type Clan } from '../../api/CR_API.js';

/**
 * Check a single clan for activity and process any changes
 *
 * @param client - Discord client
 * @param clanData - Clan settings and snapshot data from database
 */
export async function checkClanActivity(client: Client, clanData: ClanActivityData): Promise<void> {
  const { guild_id, clantag, clan_name, clan_logs_channel_id } = clanData;

  try {
    // Fetch current clan data from API
    const newSnapshot = await CR_API.getClan(clantag);
    if (isFetchError(newSnapshot)) {
      logger.warn(`[ClanActivityService] Failed to fetch clan ${clantag} from API: ${newSnapshot.reason}`);
      return;
    }

    // Detect changes
    const changes = detectClanChanges(clanData.last_activity_snapshot, newSnapshot);

    // Send logs if there are changes
    if (changes.length > 0) {
      await sendActivityLog(client, guild_id, clan_logs_channel_id, clan_name, changes);

      // Handle role management
      await handleRoleChanges(
        client,
        guild_id,
        clantag,
        clanData.clan_role_id,
        changes,
        clanData.clan_logs_add_role,
        clanData.clan_logs_remove_role,
        clanData.clan_roles_required_role_id,
      );
    }

    // Update snapshot in database
    await updateSnapshot(guild_id, clantag, newSnapshot);
  } catch (error) {
    logger.error(`[ClanActivityService] Error checking clan ${clantag}:`, error);
  }
}

/**
 * Send activity log to Discord channel (one message per change)
 */
async function sendActivityLog(
  client: Client,
  guildId: string,
  channelId: string,
  _clanName: string,
  changes: ClanChange[],
): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !(channel instanceof TextChannel)) {
      // logger.warn(`[ClanActivityService] Channel ${channelId} not found or not a text channel`);
      return;
    }

    // Batch query all playertags to get Discord user info
    const playertags = changes
      .filter((change): change is Extract<ClanChange, { playertag: string }> => change.type !== 'clan_property_change')
      .map((change) => change.playertag);

    const discordUserMap = new Map<string, User>();

    if (playertags.length > 0) {
      try {
        const result = await pool.query(
          `SELECT playertag, discord_id FROM user_playertags WHERE guild_id = $1 AND playertag = ANY($2)`,
          [guildId, playertags],
        );

        // Fetch Discord users for all linked players
        for (const row of result.rows) {
          try {
            const user = await client.users.fetch(row.discord_id);
            discordUserMap.set(row.playertag, user);
          } catch {
            // User might have left the guild or Discord, skip
          }
        }
      } catch (err) {
        logger.warn(`[ClanActivityService] Error fetching linked users:`, err);
      }
    }

    // Send each change as a separate embed message
    for (const change of changes) {
      const playertag = change.type !== 'clan_property_change' ? change.playertag : null;
      const discordUser = playertag ? discordUserMap.get(playertag) : undefined;

      const embed = formatClanChange(change, discordUser);
      await channel.send({ embeds: [embed] });
      // Small delay to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) {
    logger.error('[ClanActivityService] Error sending activity log:', error);
  }
}

/**
 * Update clan snapshot in database
 */
async function updateSnapshot(guildId: string, clantag: string, snapshot: Clan): Promise<void> {
  try {
    const query = buildUpdateActivitySnapshot(guildId, clantag, snapshot, new Date());
    const result = await pool.query(query);

    if (result.rowCount === 0) {
      logger.warn(
        `[ClanActivityService] No rows updated for clan ${clantag} in guild ${guildId} - clan might not exist`,
      );
    }
  } catch (error) {
    logger.error(`[ClanActivityService] Error updating snapshot for clan ${clantag}:`, error);
  }
}
