/**
 * Race Tracking Service Layer
 *
 * High-level functions that wrap API calls and database operations.
 * These functions are called by commands and return processed, ready-to-display data.
 */

import { pool } from '../../db.js';
import { CR_API, isFetchError } from '../../api/CR_API.js';
import type { CurrentRiverRace, CurrentRiverRaceLogResult } from '../../api/CR_API.js';
import type { RaceAttacksData, RaceHistoryData, RaceStatsData, RaceUpdateResult } from './types.js';
import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { buildAttacksEmbed, buildRaceEmbed } from './embedBuilders.js';
import { resetCustomNudgeMessageOnNewDay } from './nudgeHelper.js';
import { BOTCOLOR, EmbedColor } from '../../types/EmbedUtil.js';
import { getEmoji, hasEmoji } from '../../utils/emoji.js';
import logger from '../../logger.js';

// In-memory cache to prevent concurrent updates to the same race
const ongoingRaceUpdates = new Map<string, Promise<RaceUpdateResult | null>>();

// Discord client for sending messages (set by bot.ts on startup)
let discordClient: Client | null = null;

/**
 * Set the Discord client for the race tracking service.
 * Must be called once during bot startup.
 */
export function setDiscordClient(client: Client): void {
  discordClient = client;
}

export const periodTypeMap: { [key: string]: string } = {
  training: 'Training',
  warDay: 'War Day',
  colosseum: 'Colosseum',
};

/**
 * Get badge emoji with optional suffix fallback.
 * If suffix is provided, tries badgeId_suffix first, then falls back to badgeId.
 *
 * @param badgeId - Badge ID number from Clash Royale API
 * @param suffix - Optional suffix (e.g., '4k', '5k')
 * @returns Formatted emoji string
 *
 * @example
 * ```ts
 * getBadgeEmoji(16000001, '5k'); // Tries '16000001_5k', falls back to '16000001'
 * getBadgeEmoji(16000001);        // Returns '16000001' emoji
 * ```
 */
export function getBadgeEmoji(badgeId: number, suffix?: string): string {
  const badgeIdStr = badgeId.toString();

  if (suffix) {
    const withSuffix = `${badgeIdStr}_${suffix}`;
    if (hasEmoji(withSuffix)) {
      return getEmoji(withSuffix);
    }
  }

  return getEmoji(badgeIdStr);
}

/**
 * Get badge emoji with automatic suffix based on clan score.
 * Determines suffix from score: 5000+ = '5k', 4000+ = '4k', else no suffix.
 *
 * @param badgeId - Badge ID number from Clash Royale API
 * @param clanScore - Clan score/trophies
 * @returns Formatted emoji string with appropriate suffix
 *
 * @example
 * ```ts
 * getClanBadgeEmoji(16000001, 5200); // Tries '16000001_5k', falls back to '16000001'
 * getClanBadgeEmoji(16000001, 4500); // Tries '16000001_4k', falls back to '16000001'
 * getClanBadgeEmoji(16000001, 3000); // Returns '16000001' emoji (no suffix)
 * ```
 */
export function getClanBadgeEmoji(badgeId: number, clanScore: number): string {
  let suffix: string | undefined;

  if (clanScore >= 5000) {
    suffix = '5k';
  } else if (clanScore >= 4000) {
    suffix = '4k';
  }

  return getBadgeEmoji(badgeId, suffix);
}

/**
 * Convert internal day number to display-friendly number.
 * Training days are stored as negative (-1 to -7), convert to positive for display.
 *
 * @param day - Internal day number
 * @returns Positive day number for display
 */
export function getDayForDisplay(day: number): number {
  return Math.abs(day);
}

/**
 * Get attack information for a clan's race.
 * Uses HYBRID approach: Fresh data for requested clan, recent cache for cross-clan totals.
 *
 * Returns list of participants with attacks remaining, flagging cross-clan attackers.
 *
 * @param guildId - Discord guild ID
 * @param raceData - Current river race data from API
 * @param seasonId - Season ID
 * @param warWeek - War week number
 * @returns Processed attack data ready for display
 */
export async function getRaceAttacks(
  guildId: string,
  raceId: number,
  raceData: CurrentRiverRace,
  seasonId: number | null,
  warWeek: number,
): Promise<RaceAttacksData | null> {
  const clanData = await CR_API.getClan(raceData.clan.tag);
  if (isFetchError(clanData)) {
    console.error(`[getRaceAttacks] Failed to fetch clan data for ${raceData.clan.tag}:`, clanData.reason);
    return null;
  }

  const members = clanData.memberList;
  if (!members || members.length === 0) {
    console.log(`[getRaceAttacks] No members found for clan ${raceData.clan.tag}`);
    return null;
  }

  const memberTags = new Set(members.map((m) => m.tag));
  const activeMembers = raceData.clan.participants.filter((p) => memberTags.has(p.tag) || p.decksUsedToday > 0);

  if (activeMembers.length === 0) {
    return null;
  }

  // Check if boat is completed (10k+ fame)
  const isBoatCompleted = raceData.clan.fame >= 10000 && periodTypeMap[raceData.periodType] === 'War Day';

  // Get cross-clan attack totals from DB
  const playertags = activeMembers.map((m) => m.tag);

  const currentDay = getWarDay(raceData);

  const attacksQuery = await pool.query(
    `
    SELECT 
      rpt.race_id,
      rpt.playertag,
      rpt.player_name,
      rpt.clans_attacked_in,
      rpt.clan_names_attacked_in,
      u.ping_user,
      u.is_replace_me,
      u.is_attacking_late,
      up.discord_id,
      -- Compute total across all guild clans FOR CURRENT DAY ONLY
      (SELECT COALESCE(SUM(rpt2.decks_used_today), 0)
       FROM race_participant_tracking rpt2
       JOIN river_races rr2 ON rpt2.race_id = rr2.race_id
       JOIN clans c2 ON c2.clantag = rr2.clantag AND c2.guild_id = $1
       WHERE rpt2.playertag = rpt.playertag
         AND rr2.current_week = $2
         AND rpt2.current_day = $3
      ) as total_attacks
    FROM race_participant_tracking rpt
    LEFT JOIN user_playertags up ON rpt.playertag = up.playertag AND up.guild_id = $1
    LEFT JOIN users u ON up.discord_id = u.discord_id AND u.guild_id = $1
    WHERE rpt.race_id = $4
      AND rpt.playertag = ANY($5)
  `,
    [guildId, warWeek, currentDay, raceId, playertags],
  );

  // Build map of player attack data
  const playerAttackMap = new Map<
    string,
    {
      totalDecks: number;
      clansAttackedIn: string[];
      clanNamesAttackedIn: string[];
      pingUser: boolean;
      isReplacementPlayer: boolean;
      isAttackingLate: boolean;
      discordId: string | null;
    }
  >();
  for (const row of attacksQuery.rows) {
    playerAttackMap.set(row.playertag, {
      totalDecks: row.total_attacks,
      clansAttackedIn: row.clans_attacked_in || [],
      clanNamesAttackedIn: row.clan_names_attacked_in || [],
      pingUser: row.ping_user ?? true,
      isReplacementPlayer: row.is_replace_me || false,
      isAttackingLate: row.is_attacking_late || false,
      discordId: row.discord_id || null,
    });
  }

  // Include ALL active members (those who haven't done 4 attacks OR split attacks across clans)
  // OR if boat is completed, show who DID attack today
  const playersNeedingAttacks = activeMembers
    .map((member) => {
      const attackData = playerAttackMap.get(member.tag);
      const totalAttacks = attackData?.totalDecks || 0;
      const clantagsAttacked = attackData?.clansAttackedIn || [];
      const clansAttackedNames = attackData?.clanNamesAttackedIn || [];
      const isInClan = memberTags.has(member.tag);

      // Check if they're in this clan but attacked elsewhere
      const hasAttackedElsewhere = isInClan && member.decksUsedToday === 0 && clansAttackedNames.length > 0;

      return {
        playertag: member.tag,
        playerName: member.name,
        attacksUsedToday: member.decksUsedToday,
        attacksRemaining: 4 - totalAttacks,
        fame: member.fame,
        totalDecksUsed: member.decksUsed,
        clantag: raceData.clan.tag,
        clanName: raceData.clan.name,
        clansAttackedIn: clansAttackedNames,
        isSplitAttacker: clantagsAttacked.length > 1,
        isInClan,
        hasAttackedElsewhere,
        pingUser: attackData?.pingUser ?? true,
        isReplacementPlayer: attackData?.isReplacementPlayer || false,
        isAttackingLate: attackData?.isAttackingLate || false,
        discordUserId: attackData?.discordId || undefined,
      };
    })
    .filter((p) => {
      // If boat is completed, show who DID attack today
      if (isBoatCompleted) {
        return p.attacksUsedToday > 0;
      }
      // Otherwise, show incomplete attacks or special cases
      return p.attacksRemaining > 0 || p.isSplitAttacker || p.hasAttackedElsewhere;
    });

  // Sort by attacks remaining (most needed first), then alphabetically by name
  // For boat completion, sort by attacks used today (most attacks first)
  const participants = playersNeedingAttacks.sort((a, b) => {
    if (isBoatCompleted) {
      // Sort by attacks used today descending, then by name
      if (b.attacksUsedToday !== a.attacksUsedToday) {
        return b.attacksUsedToday - a.attacksUsedToday;
      }
      return a.playerName.localeCompare(b.playerName);
    }

    // Normal sorting
    if (b.attacksRemaining !== a.attacksRemaining) {
      return b.attacksRemaining - a.attacksRemaining;
    }
    return a.playerName.localeCompare(b.playerName);
  });

  // Calculate totals
  const totalDecksUsed = raceData.clan.participants.reduce((sum, p) => sum + p.decksUsed, 0);
  const totalDecksUsedToday = raceData.clan.participants.reduce((sum, p) => sum + p.decksUsedToday, 0);
  const totalAttacksRemaining = 200 - totalDecksUsedToday;

  // Count unique participants who attacked today (max 50)
  const participantsWhoAttacked = raceData.clan.participants.filter((p) => p.decksUsedToday > 0).length;
  const availableAttackers = 50 - participantsWhoAttacked;

  return {
    clanInfo: {
      clantag: raceData.clan.tag,
      name: raceData.clan.name,
      fame: raceData.clan.fame,
      totalDecksUsed,
      totalDecksUsedToday,
    },
    participants,
    totalAttacksRemaining,
    availableAttackers,
    raceDay: getWarDay(raceData),
    raceState: raceData.periodType,
    seasonId,
    warWeek,
    raceId: attacksQuery.rows[0].race_id,
    isBoatCompleted,
  };
}

/**
 * Get race statistics for a clan.
 * Returns overall race info, stats, and top contributors.
 *
 * @param guildId - Discord guild ID
 * @param clantag - Clan tag (normalized with #)
 * @returns Race statistics ready for display
 */
export function getRaceStats(guildId: string, data: CurrentRiverRace): RaceStatsData | null {
  // TODO: Implement
  // 1. Call getCurrentRiverRace(clantag)
  // 2. Get or create race record
  // 3. Calculate stats:
  //    - Total participants
  //    - Total attacks used today
  //    - Average fame per participant
  //    - Rank (position in clans array)
  // 4. Get top 5 contributors by fame
  // 5. Return formatted stats

  if (periodTypeMap[data.periodType] === 'Training') {
    const sorted = [...data.clans].sort(function (a, b) {
      const nameA = a.name;
      const nameB = b.name;
      return nameA.localeCompare(nameB);
    });
    return {
      type: 'training',
      day: getWarDay(data),
      week: getWarWeek(data),
      clans: sorted.map((clan) => ({
        clantag: clan.tag,
        name: clan.name,
        fame: clan.fame,
        attacksUsedToday: clan.participants.reduce((sum, p) => sum + p.decksUsedToday, 0),
        participantCount: clan.participants.filter((p) => p.decksUsedToday > 0).length,
        badgeId: getClanBadgeEmoji(clan.badgeId, clan.clanScore),
      })),
    };
  }

  if (periodTypeMap[data.periodType] === 'Colosseum') {
    const warDay = getWarDay(data);

    // Calculate projected fame for each clan and sort by it
    const clansWithProjected = data.clans.map((clan) => {
      const attacksUsedToday = clan.participants.reduce((sum, p) => sum + p.decksUsedToday, 0);

      let totalDecksUsed = 0;
      if (warDay !== 1) {
        totalDecksUsed = warDay * 200 - 200;
      }
      const totalDecks = attacksUsedToday + totalDecksUsed;
      const average = totalDecks > 0 ? clan.fame / totalDecks : 0;
      const projectedFameRaw =
        clan.fame + Math.round(200 * (4 - warDay) * average) + Math.round((200 - attacksUsedToday) * average);
      const projectedFame = Math.round(projectedFameRaw / 50) * 50;

      return {
        clantag: clan.tag,
        name: clan.name,
        fame: clan.fame,
        participantCount: clan.participants.filter((p) => p.decksUsedToday > 0).length,
        attacksUsedToday,
        coloAverage: average,
        projectedFame,
        badgeId: getClanBadgeEmoji(clan.badgeId, clan.clanScore),
      };
    });

    // Sort by projected fame descending
    const sorted = clansWithProjected.sort((a, b) => b.projectedFame - a.projectedFame);

    // Add ranks
    return {
      type: 'colosseum',
      day: warDay,
      week: getWarWeek(data),
      clans: sorted.map((clan, index) => ({
        ...clan,
        projectedRank: getOrdinal(index + 1),
      })),
    };
  }

  // War Day
  const warDay = getWarDay(data);

  // Calculate projected fame for each clan
  const clansWithProjected = data.clans.map((clan) => {
    const attacksUsedToday = clan.participants.reduce((sum, p) => sum + p.decksUsedToday, 0);
    const average = attacksUsedToday > 0 ? (clan.periodPoints ?? 0) / attacksUsedToday : 0;
    const projectedFameRaw = (clan.periodPoints ?? 0) + Math.round((200 - attacksUsedToday) * average);
    const projectedFame = Math.round(projectedFameRaw / 50) * 50;
    const isBoatCompleted = clan.fame >= 10000 && periodTypeMap[data.periodType] === 'War Day'; // Boat completed at 10k+ fame

    return {
      clantag: clan.tag,
      name: clan.name,
      fame: clan.periodPoints ?? 0,
      boatPoints: clan.fame,
      participantCount: clan.participants.filter((p) => p.decksUsedToday > 0).length,
      attacksUsedToday,
      average,
      projectedFame,
      isBoatCompleted,
      badgeId: getClanBadgeEmoji(clan.badgeId, clan.clanScore),
    };
  });

  // Sort by projected fame descending for ranking
  const sortedByProjected = [...clansWithProjected].sort((a, b) => b.projectedFame - a.projectedFame);

  // Also sort by current fame for current rank
  // Boat-completed clans (10k+) always come first
  const sortedByFame = [...clansWithProjected].sort((a, b) => {
    // Boat completed clans always rank first
    if (a.isBoatCompleted && !b.isBoatCompleted) return -1;
    if (!a.isBoatCompleted && b.isBoatCompleted) return 1;

    // If both completed or both not completed, sort by fame
    if (a.fame === b.fame) {
      return -1; // A comes first
    }
    return b.fame - a.fame; // Descending order
  });

  return {
    type: 'warDay',
    day: warDay,
    week: getWarWeek(data),
    clans: sortedByFame.map((clan, index) => {
      // Find projected rank for this clan
      const projectedRankNum = sortedByProjected.findIndex((c) => c.clantag === clan.clantag) + 1;
      return {
        ...clan,
        rank: index + 1,
        projectedRank: getOrdinal(projectedRankNum),
      };
    }),
  };
}

function getOrdinal(num: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const value = num % 100;

  // Handle special cases for 11th, 12th, 13th
  if (value >= 11 && value <= 13) {
    return num + 'th';
  }

  // Get the last digit and use appropriate suffix
  const lastDigit = num % 10;
  return num + (suffixes[lastDigit] || 'th');
}

/**
 * Create a snapshot of the current race day.
 * Stores both raw API data and computed embed data for display.
 *
 * @param raceId - Race ID
 * @param guildId - Discord guild ID
 * @param raceData - Raw API response from getCurrentRiverRace
 * @param seasonId - Season ID (nullable)
 * @param warWeek - War week number
 * @param day - Race day to snapshot
 * @returns True if snapshot created successfully
 */
export async function createDaySnapshot(
  raceId: number,
  guildId: string,
  raceData: CurrentRiverRace,
  seasonId: number | null,
  warWeek: number,
  day: number,
): Promise<boolean> {
  try {
    if (!raceData) {
      console.log(`[Snapshot] No race data available to create snapshot for race ${raceId} day ${day}`);
      return false;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get the attacks data (what /attacks would show)
      const attacksData = await getRaceAttacks(guildId, raceId, raceData, seasonId, warWeek);
      if (!attacksData) {
        console.error(`[Snapshot] Failed to get race attacks data for race ${raceId} day ${day}`);
        await client.query('ROLLBACK');
        return false;
      }

      const raceStatsData = await getRaceStats(guildId, raceData);
      if (!raceStatsData) {
        console.error(`[Snapshot] Failed to get race stats data for race ${raceId} day ${day}`);
        await client.query('ROLLBACK');
        return false;
      }

      // Group participants by attacks remaining (or attacks used if boat completed)
      const grouped = new Map<number, typeof attacksData.participants>();
      for (const p of attacksData.participants) {
        // For boat completion, group by attacks used; otherwise by attacks remaining
        const key = attacksData.isBoatCompleted ? p.attacksUsedToday : p.attacksRemaining;
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(p);
      }

      // Build groups array for snapshot
      const groups = Array.from(grouped.entries())
        .sort((a, b) => b[0] - a[0]) // Sort descending (most attacks first)
        .map(([value, players]) => ({
          attacksRemaining: value, // Note: For boat completion, this is actually attacks used
          count: players.length,
          players: players
            .sort((a, b) => a.playerName.localeCompare(b.playerName))
            .map((player) => {
              const emojis: string[] = [];
              if (player.isSplitAttacker) emojis.push('☠️');
              if (player.hasAttackedElsewhere) emojis.push('🚫');
              if (player.isReplacementPlayer) emojis.push('⚠️');
              if (player.isAttackingLate) emojis.push('⏰');
              if (!player.isInClan) emojis.push('❌');

              return {
                name: player.playerName,
                emojis,
                clansAttackedIn:
                  player.clansAttackedIn.length > 1 || player.hasAttackedElsewhere ? player.clansAttackedIn : undefined,
              };
            }),
        }));

      // Build legend (only items that are present)
      const legend: string[] = [];
      if (attacksData.participants.some((p) => p.isSplitAttacker)) legend.push('☠️ Split Attacker');
      if (attacksData.participants.some((p) => p.hasAttackedElsewhere)) legend.push('🚫 Do Not Attack');
      if (attacksData.participants.some((p) => p.isReplacementPlayer)) legend.push('⚠️ Replace Me');
      if (attacksData.participants.some((p) => p.isAttackingLate)) legend.push('⏰ Attacking Late');
      if (attacksData.participants.some((p) => !p.isInClan)) legend.push('❌ Left Clan');

      // console.log(raceStatsData);
      // Build complete snapshot data (raw + computed)
      const snapshotData = {
        rawApiData: raceData, // Store raw API response
        embedData: {
          // Pre-computed embed data for fast display
          attacks: {
            clanName: attacksData.clanInfo.name,
            clantag: attacksData.clanInfo.clantag,
            seasonId: attacksData.seasonId,
            warWeek: attacksData.warWeek,
            raceDay: attacksData.raceDay,
            availableAttackers: attacksData.availableAttackers,
            totalAttacksRemaining: attacksData.totalAttacksRemaining,
            isBoatCompleted: attacksData.isBoatCompleted,
            groups,
            legend,
          },
          // TODO: Add race stats data when /race is implemented
          race: {
            type: raceStatsData.type,
            day: raceStatsData.day,
            week: raceStatsData.week,
            clans: raceStatsData.clans,
          },
        },
      };

      // Store or update guild-specific snapshot
      await client.query(
        `
        INSERT INTO race_day_snapshots
        (race_id, guild_id, race_day, snapshot_time, snapshot_data)
        VALUES ($1, $2, $3, NOW(), $4)
        ON CONFLICT (race_id, guild_id, race_day)
        DO UPDATE SET
          snapshot_time = NOW(),
          snapshot_data = EXCLUDED.snapshot_data
      `,
        [raceId, guildId, day, JSON.stringify(snapshotData)],
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(`[Snapshot] Error creating snapshot:`, error);
    return false;
  }
}

/**
 * Get historical race data for a specific day.
 *
 * @param guildId - Discord guild ID
 * @param clantag - Clan tag (normalized with #)
 * @param day - Race day (1-4)
 * @returns Historical snapshot data or null if not found
 */
export async function getRaceHistory(guildId: string, clantag: string, day: number): Promise<RaceHistoryData | null> {
  // TODO: Implement
  // 1. Query river_races to get race_id for clan
  // 2. Query race_day_snapshots for specific day
  // 3. Parse snapshot_data JSONB
  // 4. Return formatted historical data

  throw new Error('Not implemented yet');
}

/**
 * Initialize or update a race record from API data.
 * Called by scheduler and on-demand by commands.
 * Debounced to prevent concurrent updates to the same clan.
 *
 * @param clantag - Clan tag (normalized with #)
 * @returns Race ID
 */
export async function initializeOrUpdateRace(clantag: string): Promise<RaceUpdateResult | null> {
  // Check if there's already an ongoing update for this clan
  const existingUpdate = ongoingRaceUpdates.get(clantag);
  if (existingUpdate) {
    return existingUpdate;
  }

  // Create new update promise
  const updatePromise = performRaceUpdate(clantag);

  // Cache it
  ongoingRaceUpdates.set(clantag, updatePromise);

  // Clean up when done (regardless of success/failure)
  updatePromise.finally(() => {
    ongoingRaceUpdates.delete(clantag);
  });

  return updatePromise;
}

/**
 * Internal function that performs the actual race update.
 * Should not be called directly - use initializeOrUpdateRace instead.
 */
async function performRaceUpdate(clantag: string): Promise<RaceUpdateResult | null> {
  // 1. Call getCurrentRiverRace(clantag)
  // 2. Call getRiverRaceLog(clantag) to get season_id and section_index
  // 3. Check if race exists (match on clan_tag + section_index, season_id if known)
  // 4. If exists, update current_data, last_check, race_state
  // 5. If not exists, create new race record:
  //    - Extract opponent_clans from race log standings
  //    - Set season_id (or NULL if not available)
  //    - Set start_time = end_time = NOW()
  // 6. Return race_id
  const raceData = await CR_API.getCurrentRiverRace(clantag);
  if (isFetchError(raceData)) {
    console.error(`[Race Init] Failed to fetch current race for ${clantag}:`, raceData.reason);
    return null;
  }

  const rrLog = await CR_API.getRiverRaceLog(clantag);
  if (isFetchError(rrLog)) {
    console.error(`[Race Init] Failed to fetch river race log for ${clantag}:`, rrLog.reason);
    return null;
  }
  const seasonId: number | null = detectSeasonId(rrLog);
  const warDay: number = getWarDay(raceData);
  const warWeek: number = getWarWeek(raceData);
  const periodType = raceData.periodType;
  const clanName = raceData.clan.name;

  // Get existing race data in one query (including fields needed for rollover detection)
  const existingRace = await pool.query(
    `SELECT race_id, current_day, current_data, end_time 
     FROM river_races 
     WHERE clantag = $1 AND current_week = $2 
     AND (
       (season_id = $3 AND $3 IS NOT NULL) 
       OR (season_id IS NULL AND $3 IS NULL)
     )`,
    [clantag, warWeek, seasonId],
  );

  const oppClans = raceData.clans
    .map((clan) => ({ clantag: clan.tag, clan_name: clan.name }))
    .sort((a, b) => a.clantag.localeCompare(b.clantag));

  let raceId: number;
  let endTime: Date | null;

  if (existingRace.rows.length > 0) {
    raceId = existingRace.rows[0].race_id;

    const oldDay = existingRace.rows[0]?.current_day || 0;
    const oldRaceData = existingRace.rows[0]?.current_data;

    // Detect day rollover using isNewWarDay function
    let isRollover = false;
    let guildsTracking: string[] = [];
    if (oldRaceData && isNewWarDay(oldRaceData, raceData)) {
      isRollover = true;
      // Only create snapshots if old race was NOT training day
      if (oldRaceData.periodType !== 'training') {
        // Create snapshots for ALL guilds tracking this clan (snapshots are guild-specific)
        const guildsTrackingQuery = await pool.query(`SELECT DISTINCT guild_id FROM clans WHERE clantag = $1`, [
          clantag,
        ]);
        guildsTracking = guildsTrackingQuery.rows.map((r) => r.guild_id);

        // Create snapshots in parallel for all guilds
        await Promise.all(
          guildsTracking.map((guildId) => createDaySnapshot(raceId, guildId, oldRaceData, seasonId, warWeek, oldDay)),
        );
      } else {
        // Still get guilds for potential staff channel notifications
        const guildsTrackingQuery = await pool.query(`SELECT DISTINCT guild_id FROM clans WHERE clantag = $1`, [
          clantag,
        ]);
        guildsTracking = guildsTrackingQuery.rows.map((r) => r.guild_id);
      }
    }

    // Update race, setting end_time only on rollover
    const updateResult = await pool.query(
      `
      UPDATE river_races
      SET
        current_data = $1,
        last_check = NOW(),
        race_state = $2,
        current_day = $3,
        season_id = $4,
        opponent_clans = $5
        ${isRollover ? ', end_time = NOW()' : ''}
      WHERE race_id = $6
      RETURNING end_time
    `,
      [JSON.stringify(raceData), raceData.periodType, warDay, seasonId, JSON.stringify(oppClans), raceId],
    );
    endTime = updateResult.rows[0].end_time;

    // Auto-post to staff channels AFTER updating end_time (use old data before rollover)
    // Only post if old state was warDay or colosseum, not training
    if (
      isRollover &&
      discordClient &&
      (oldRaceData.periodType === 'warDay' || oldRaceData.periodType === 'colosseum')
    ) {
      await postRolloverToStaffChannels(clantag, raceId, oldRaceData, seasonId, warWeek, oldDay, guildsTracking);
      // Reset custom nudge messages for new day
      for (const guildId of guildsTracking) {
        await resetCustomNudgeMessageOnNewDay(discordClient, guildId, clantag);
      }
    }
    // console.log('Updated race record for', clantag, raceId);
  } else {
    // No existing race for this week/season - finalize previous race if needed
    const prevRaceQuery = await pool.query(
      `SELECT race_id, current_day, current_data, season_id, current_week
       FROM river_races WHERE clantag = $1 ORDER BY created_at DESC LIMIT 1`,
      [clantag],
    );

    if (prevRaceQuery.rows.length > 0) {
      const prev = prevRaceQuery.rows[0];
      const prevType = prev.current_data?.periodType;

      // Create final snapshot if previous was war/colosseum (not training)
      if (prevType === 'warDay' || prevType === 'colosseum') {
        const guilds = (await pool.query(`SELECT DISTINCT guild_id FROM clans WHERE clantag = $1`, [clantag])).rows.map(
          (r) => r.guild_id,
        );

        await Promise.all(
          guilds.map((gid) =>
            createDaySnapshot(
              prev.race_id,
              gid,
              prev.current_data,
              prev.season_id,
              prev.current_week,
              prev.current_day,
            ),
          ),
        );

        await pool.query(`UPDATE river_races SET end_time = NOW() WHERE race_id = $1`, [prev.race_id]);

        if (discordClient) {
          await postRolloverToStaffChannels(
            clantag,
            prev.race_id,
            prev.current_data,
            prev.season_id,
            prev.current_week,
            prev.current_day,
            guilds,
          );
        }
      }
    }

    const result = await pool.query(
      `
      INSERT INTO river_races 
      (clan_name, clantag, race_state, current_day, current_week, season_id, current_data, opponent_clans, last_check, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING race_id, end_time
      `,
      [
        clanName,
        clantag,
        raceData.periodType,
        warDay,
        warWeek,
        seasonId,
        JSON.stringify(raceData),
        JSON.stringify(oppClans),
      ],
    );
    raceId = result.rows[0].race_id;
    endTime = result.rows[0].end_time;
    // console.log('Created new race record for', clantag, raceId);
  }

  // Update participant tracking with fresh data
  await updateParticipantTracking(raceId, raceData.clan.participants, clantag);

  return {
    raceId,
    raceData,
    seasonId,
    periodType: periodTypeMap[periodType] || periodType,
    warDay,
    warWeek,
    endTime,
  };
}

/**
 * Update participant tracking for a race.
 * Stores current state for each player in each clan (no cross-clan aggregation stored).
 *
 * @param raceId - Race ID
 * @param participants - Array of participants from API
 * @param clantag - Current clan tag
 */
export async function updateParticipantTracking(
  raceId: number,
  participants: Array<{
    tag: string;
    name: string;
    fame: number;
    decksUsed: number;
    decksUsedToday: number;
  }>,
  clantag: string,
): Promise<void> {
  // TODO: Implement
  // 1. For each participant with decksUsed >= 1:
  //    a. Build clans_attacked_in array (query where this player has decks_used >= 1)
  //    b. UPSERT into race_participant_tracking
  //       - Store only this clan's data (decks_used, decks_used_today)
  //       - Update clans_attacked_in array
  //       - Do NOT compute or store total_decks_today_all_clans (computed dynamically)
  // 2. Handle players who left clan (remove from tracking or mark inactive)

  if (!participants || participants.length === 0) {
    console.log('No participants to track for', clantag);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get active tags
    const activeTags = participants.map((p) => p.tag);

    const clanAttackMap = await client.query(
      `
      SELECT
        rpt.playertag,
        array_agg(DISTINCT rpt.clantag) as clans,
        array_agg(DISTINCT rpt.clan_name) as clan_names
      FROM race_participant_tracking rpt
      JOIN river_races rr ON rpt.race_id = rr.race_id
      WHERE rr.current_week = (SELECT current_week FROM river_races WHERE race_id = $1)
        AND rpt.current_day = (SELECT current_day FROM river_races WHERE race_id = $1)
        AND rpt.playertag = ANY($2)
        AND rpt.decks_used_today > 0
      GROUP BY rpt.playertag
    `,
      [raceId, activeTags],
    );

    const playerClanMap = new Map<string, { tags: string[]; names: string[] }>();
    for (const row of clanAttackMap.rows) {
      playerClanMap.set(row.playertag, {
        tags: row.clans || [],
        names: row.clan_names || [],
      });
    }

    // Build bulk upset values (multi-row insert)
    const values: (number | string | string[])[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    // Get clan name from race data
    const clanNameQuery = await client.query(`SELECT clan_name, current_day FROM river_races WHERE race_id = $1`, [
      raceId,
    ]);
    const currentClanName = clanNameQuery.rows[0]?.clan_name || '';
    const currentDay = clanNameQuery.rows[0]?.current_day || 0;

    for (const p of participants) {
      // get clans this player attacked in, ensure current clan included IF they attacked
      const clanData = playerClanMap.get(p.tag) || { tags: [], names: [] };
      const clansAttackedTags = [...clanData.tags];
      const clansAttackedNames = [...clanData.names];

      // Only add current clan to the list if they actually attacked here
      if (p.decksUsedToday > 0 && !clansAttackedTags.includes(clantag)) {
        clansAttackedTags.push(clantag);
        clansAttackedNames.push(currentClanName);
      }

      values.push(
        raceId,
        p.tag,
        p.name,
        clantag,
        currentClanName,
        currentDay,
        p.fame,
        p.decksUsed,
        p.decksUsedToday,
        clansAttackedTags,
        clansAttackedNames,
      );
      placeholders.push(
        `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10})`,
      );
      paramIndex += 11;
    }

    if (placeholders.length > 0) {
      // Single multi-row upsert
      await client.query(
        `
        INSERT into race_participant_tracking
          (race_id, playertag, player_name, clantag, clan_name, current_day, fame, decks_used, decks_used_today, clans_attacked_in, clan_names_attacked_in)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (race_id, playertag, clantag)
        DO UPDATE SET 
          player_name = EXCLUDED.player_name,
          clan_name = EXCLUDED.clan_name,
          current_day = EXCLUDED.current_day,
          fame = EXCLUDED.fame,
          decks_used = EXCLUDED.decks_used,
          decks_used_today = EXCLUDED.decks_used_today,
          clans_attacked_in = EXCLUDED.clans_attacked_in,
          clan_names_attacked_in = EXCLUDED.clan_names_attacked_in,
          last_updated = NOW()
        `,
        values,
      );
    }
    await client.query('COMMIT');
    // console.log(`Updated participant tracking for ${participants.length} participants in clan ${clantag}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating participant tracking:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get Discord user IDs for linked player tags.
 *
 * @param guildId - Discord guild ID
 * @param playertags - Array of player tags to look up
 * @returns Map of playerTag -> userId
 */
export async function getLinkedPlayers(guildId: string, playertags: string[]): Promise<Map<string, string>> {
  // TODO: Implement
  // Join user_playertags table to get discord ids
  // Return as Map for easy lookup

  const linkedPlayers = new Map<string, string>();

  const result = await pool.query(
    `SELECT playertag, discord_id FROM user_playertags WHERE guild_id = $1 AND playertag = ANY($2)`,
    [guildId, playertags],
  );

  for (const row of result.rows) {
    linkedPlayers.set(row.playertag, row.discord_id);
  }

  return linkedPlayers;
}

function detectSeasonId(rrLog: CurrentRiverRaceLogResult): number | null {
  if (isFetchError(rrLog) || rrLog.items.length === 0) {
    return null;
  }

  const lastRace = rrLog.items[0];

  // Parse custom date format: 20260330T094406.000Z -> 2026-03-30T09:44:06.000Z
  const dateStr = lastRace.createdDate;
  const isoDateStr = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T${dateStr.slice(9, 11)}:${dateStr.slice(11, 13)}:${dateStr.slice(13)}`;

  const createdDate = new Date(isoDateStr);
  const daysSinceCreated = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

  // Old data, can't confirm season id / week
  if (daysSinceCreated > 8) {
    return null;
  }

  const clansWithHighestTrophies = lastRace.standings.filter((standing) => standing.trophyChange >= 20);
  const wasColosseumWeek = clansWithHighestTrophies.length >= 2;
  if (wasColosseumWeek) {
    return lastRace.seasonId + 1;
  } else {
    // Same season
    return lastRace.seasonId;
  }
}

function getWarWeek(raceData: CurrentRiverRace): number {
  return raceData.sectionIndex + 1;
}

function getWarDay(raceData: CurrentRiverRace): number {
  switch (raceData.periodType) {
    case 'training':
      return -((raceData.periodIndex % 7) + 1); // -1 to -7 for training days
    default:
      return (raceData.periodIndex % 7) - 2; // 1 to 4 for war/colosseum days
  }
}

/**
 * Detect if a new war day has started by comparing previous and current race data.
 *
 * @param previousRaceData - Previous race data from database
 * @param newRaceData - New race data from API
 * @returns True if a new war day has started
 */
function isNewWarDay(previousRaceData: CurrentRiverRace, newRaceData: CurrentRiverRace): boolean {
  // Compare newRaceData vs previousRaceData to detect if day changed
  // Consider: periodIndex changes, decksUsedToday resets, etc.

  let oldAttacks = 0;
  let newAttacks = 0;
  for (const clan of previousRaceData.clans) {
    oldAttacks += clan.participants.reduce((sum, p) => sum + p.decksUsedToday, 0);
  }
  for (const clan of newRaceData.clans) {
    newAttacks += clan.participants.reduce((sum, p) => sum + p.decksUsedToday, 0);
  }

  const clantag = newRaceData.clan.tag;
  const oldPeriod = previousRaceData.periodType;
  const newPeriod = newRaceData.periodType;
  const oldPeriodIndex = previousRaceData.periodIndex;
  const newPeriodIndex = newRaceData.periodIndex;

  if (newAttacks - oldAttacks === 0) {
    // No change in attacks, check if periodIndex changed (handles edge case of no attacks for any clan)
    if (newRaceData.periodIndex !== previousRaceData.periodIndex) {
      logger.info(
        `[Rollover Detected - ${clantag}] Reason: periodIndex changed | ` +
          `Old: ${oldPeriod} (index: ${oldPeriodIndex}, attacks: ${oldAttacks}) | ` +
          `New: ${newPeriod} (index: ${newPeriodIndex}, attacks: ${newAttacks})`,
      );
      return true;
    } else {
      return false;
    }
  }

  if (newAttacks < oldAttacks) {
    logger.info(
      `[Rollover Detected - ${clantag}] Reason: attacks reset | ` +
        `Old: ${oldPeriod} (index: ${oldPeriodIndex}, attacks: ${oldAttacks}) | ` +
        `New: ${newPeriod} (index: ${newPeriodIndex}, attacks: ${newAttacks}) | ` +
        `Delta: ${newAttacks - oldAttacks}`,
    );
    return true;
  }

  return false;
}

/**
 * Post rollover summaries to staff channels.
 * Sends both /attacks and /race data from before the rollover.
 *
 * @param clantag - Clan tag
 * @param raceId - Race ID
 * @param oldRaceData - Race data before rollover
 * @param seasonId - Season ID
 * @param warWeek - War week number
 * @param oldDay - Day number before rollover
 * @param guildIds - Guild IDs tracking this clan
 */
async function postRolloverToStaffChannels(
  clantag: string,
  raceId: number,
  oldRaceData: CurrentRiverRace,
  seasonId: number | null,
  warWeek: number,
  oldDay: number,
  guildIds: string[],
): Promise<void> {
  if (!discordClient) {
    console.error('[Rollover] Discord client not set, cannot post to staff channels');
    return;
  }

  try {
    // Get all staff channels for guilds tracking this clan
    const channelsQuery = await pool.query(
      `SELECT DISTINCT guild_id, staff_channel_id, eod_stats_enabled
       FROM clans 
       WHERE clantag = $1 AND staff_channel_id IS NOT NULL AND guild_id = ANY($2)`,
      [clantag, guildIds],
    );

    if (channelsQuery.rows.length === 0) {
      return;
    }

    // Post to each staff channel
    for (const row of channelsQuery.rows) {
      const guildId = row.guild_id;
      const staffChannelId = row.staff_channel_id;
      const eodStatsEnabled = row.eod_stats_enabled;

      // Skip if eod_stats_enabled is false
      if (!eodStatsEnabled) {
        continue;
      }

      try {
        const channel = await discordClient.channels.fetch(staffChannelId);
        if (!channel || !channel.isTextBased()) {
          console.error(`[Rollover] Channel ${staffChannelId} not found or not text-based`);
          continue;
        }

        // Generate both embeds - always show race stats, show attacks if available
        const attacksData = await getRaceAttacks(guildId, raceId, oldRaceData, seasonId, warWeek);
        const stats = getRaceStats(guildId, oldRaceData);

        if (stats) {
          const raceEmbed = buildRaceEmbed(stats, clantag, seasonId, warWeek, oldDay, null);
          const embeds = [raceEmbed];

          // Add attacks embed if there are incomplete attacks
          if (attacksData) {
            const attacksEmbed = await buildAttacksEmbed(guildId, attacksData, oldRaceData, null, false);
            attacksEmbed.setURL(null); // Remove URL to prevent Discord deduplication with race embed
            attacksEmbed.setTimestamp();
            embeds.push(attacksEmbed);
          } else {
            // All attacks completed - add timestamp to race embed instead
            raceEmbed.setTimestamp();
          }

          await (channel as TextChannel).send({
            content: `## 📊 Day ${getDayForDisplay(oldDay)} Summary`,
            embeds: embeds,
          });
        }
      } catch (error) {
        console.error(`[Rollover] Failed to post to channel ${staffChannelId}:`, error);
      }
    }
  } catch (error) {
    console.error(`[Rollover] Failed to post rollover summaries for ${clantag}:`, error);
  }
}

/**
 * Test wrapper for rollover detection - exposed for testing purposes.
 *
 * @param oldData - Old race data (from fixture or DB)
 * @param newData - New race data (from fixture or API)
 * @returns Detection result
 */
export function testRolloverDetection(oldData: CurrentRiverRace, newData: CurrentRiverRace): boolean {
  return isNewWarDay(oldData, newData);
}

export async function postRacePingsToChannels(
  guildId: string,
  playertags: Array<string>,
  type: 'replace' | 'late',
  messages?: Map<string, string>, // Optional map of playertag -> message
): Promise<void> {
  if (!playertags || playertags.length === 0) {
    console.log('No playertags provided');
    return;
  }

  if (!discordClient) {
    console.error('[Race Pings] Discord client not set');
    return;
  }

  // Structure to hold player data grouped by channel
  const channelData = new Map<
    string,
    {
      channelId: string;
      rolePing: string;
      players: Array<{ name: string; tag: string; clans: string[]; message?: string }>;
    }
  >();

  // Collect all player data and their associated clans
  for (const tag of playertags) {
    const battleLog = await CR_API.getBattleLog(tag);
    if (isFetchError(battleLog)) continue;

    const player = await CR_API.getPlayer(tag);
    if (isFetchError(player)) continue;

    const clansApplicable = new Set<string>();

    // Add current clan
    if (player?.clan?.tag) {
      clansApplicable.add(player.clan.tag);
    }

    // Add clans from battle log
    battleLog.forEach((battle) => {
      if (battle.team && battle.team.length > 0 && battle.gameMode.name !== 'TeamVsTeam') {
        battle.team.forEach((teamPlayer) => {
          if (teamPlayer.clan && teamPlayer.clan.tag && !clansApplicable.has(teamPlayer.clan.tag)) {
            clansApplicable.add(teamPlayer.clan.tag);
          }
        });
      }
    });

    const clanTags = Array.from(clansApplicable);
    if (clanTags.length === 0) continue;

    // Query clans table for matching clan tags with race_ping_channel_id
    const clansQuery = await pool.query(
      `SELECT clantag, clan_name, race_ping_channel_id, ping_replace_me_role_id
       FROM clans 
       WHERE guild_id = $1 
         AND clantag = ANY($2) 
         AND race_ping_channel_id IS NOT NULL`,
      [guildId, clanTags],
    );

    if (clansQuery.rows.length === 0) continue;

    // Group data by channel
    for (const clan of clansQuery.rows) {
      const channelId = clan.race_ping_channel_id;

      if (!channelData.has(channelId)) {
        channelData.set(channelId, {
          channelId,
          rolePing: clan.ping_replace_me_role_id && type === 'replace' ? `<@&${clan.ping_replace_me_role_id}>` : '',
          players: [],
        });
      }

      const channelInfo = channelData.get(channelId)!;

      // Check if player already added to this channel
      const existingPlayer = channelInfo.players.find((p) => p.tag === tag);
      if (existingPlayer) {
        // Add clan if not already in the list
        if (!existingPlayer.clans.includes(clan.clan_name)) {
          existingPlayer.clans.push(clan.clan_name);
        }
      } else {
        // Add new player entry
        const playerMessage = messages?.get(tag);
        channelInfo.players.push({
          name: player.name,
          tag: tag,
          clans: [clan.clan_name],
          message: playerMessage,
        });
      }
    }
  }

  // Send one embed per channel with all players
  const pingType = type === 'replace' ? '⚠️ Replace Me' : '⏰ Attacking Late';
  const embedColor = type === 'replace' ? EmbedColor.FAIL : EmbedColor.WARNING;

  for (const [channelId, data] of channelData) {
    try {
      const channel = await discordClient.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        console.error(`[Race Pings] Channel ${channelId} not found or not text-based`);
        continue;
      }

      // Get message (all players from one user will have the same message)
      const userMessage = data.players[0]?.message;

      // Build embed description with all players
      const playerLines = data.players.map((player) => {
        const clanList = player.clans.join(', ');
        return `* [${player.name}](<https://royaleapi.com/player/${player.tag.substring(1)}>) (${clanList})`;
      });

      let description = `**${pingType}**\n`;
      if (userMessage) {
        description += `_"${userMessage}"_\n\n`;
      }
      description += playerLines.join('\n');

      const embed = new EmbedBuilder().setDescription(description).setColor(embedColor).setTimestamp();

      await (channel as TextChannel).send({
        embeds: [embed],
        content: data.rolePing,
      });
    } catch (error) {
      console.error(`[Race Pings] Failed to send message to channel ${channelId}:`, error);
    }
  }
}
