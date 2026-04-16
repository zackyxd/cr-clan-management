/**
 * Race Tracking Service Layer
 *
 * High-level functions that wrap API calls and database operations.
 * These functions are called by commands and return processed, ready-to-display data.
 */

import { pool } from '../../db.js';
import { CR_API, getCurrentRiverRace, getRiverRaceLog, isFetchError } from '../../api/CR_API.js';
import type { CurrentRiverRace, CurrentRiverRaceLogResult } from '../../api/CR_API.js';
import type { RaceAttacksData, RaceHistoryData, RaceStatsData, RaceUpdateResult, RiverRace } from './types.js';

const periodTypeMap: { [key: string]: string } = {
  training: 'Training',
  warDay: 'War Day',
  colosseum: 'Colosseum',
};

/**
 * Get attack information for a clan's race.
 * Uses HYBRID approach: Fresh data for requested clan, recent cache for cross-clan totals.
 *
 * Returns list of participants with attacks remaining, flagging cross-clan attackers.
 *
 * @param guildId - Discord guild ID
 * @param clantag - Clan tag (normalized with #)
 * @returns Processed attack data ready for display
 */
export async function getRaceAttacks(guildId: string, clantag: string): Promise<RaceAttacksData | null> {
  // TODO: Implement
  // 1. ALWAYS fetch fresh data for requested clan (getCurrentRiverRace)
  // 2. Update race record and participant tracking
  // 3. Query participants with cross-clan totals computed via SQL:
  //    SELECT
  //      rpt.player_tag,
  //      rpt.decks_used_today as decks_in_this_clan,
  //      -- Compute total across all guild races (uses recent cache for other clans)
  //      (SELECT COALESCE(SUM(rpt2.decks_used_today), 0)
  //       FROM race_participant_tracking rpt2
  //       JOIN river_races rr2 ON rpt2.race_id = rr2.race_id
  //       WHERE rpt2.playertag = rpt.playertag
  //         AND rr2.guild_id = $1
  //         AND rr2.end_time IS NULL
  //         AND rr2.current_day > 0
  //         AND rr2.last_check > NOW() - INTERVAL '5 minutes'
  //      ) as total_decks_today_all_clans
  //    FROM race_participant_tracking rpt
  //    WHERE rpt.race_id = $2
  // 4. Calculate attacks remaining (4 - total_decks_today_all_clans)
  // 5. Get linked Discord users
  // 6. Return formatted data

  throw new Error('Not implemented yet');
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
      })),
    };
  }

  if (periodTypeMap[data.periodType] === 'Colosseum') {
    // TODO rank off projected? Calculate here or in /race?
    return {
      type: 'colosseum',
      day: getWarDay(data),
      clans: data.clans.map((clan) => ({
        clantag: clan.tag,
        name: clan.name,
        fame: clan.fame,
        participantCount: clan.participants.filter((p) => p.decksUsedToday > 0).length,
        attacksUsedToday: clan.participants.reduce((sum, p) => sum + p.decksUsedToday, 0),
      })),
    };
  }

  // War Day
  const sorted = [...data.clans].sort(function (a, b) {
    const fameA = a.periodPoints ?? 0;
    const fameB = b.periodPoints ?? 0;
    if (fameA === fameB) {
      return -1; // A comes first
    }
    return fameB - fameA; // Descending order
  });

  return {
    type: 'warDay',
    day: getWarDay(data),
    week: getWarWeek(data),
    clans: sorted.map((clan, index) => ({
      clantag: clan.tag,
      name: clan.name,
      rank: index + 1,
      fame: clan.periodPoints ?? 0,
      boatPoints: clan.fame,
      participantCount: clan.participants.filter((p) => p.decksUsedToday > 0).length,
      attacksUsedToday: clan.participants.reduce((sum, p) => sum + p.decksUsedToday, 0),
    })),
  };
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
 *
 * @param guildId - Discord guild ID
 * @param clantag - Clan tag (normalized with #)
 * @returns Race ID
 */
export async function initializeOrUpdateRace(guildId: string, clantag: string): Promise<RaceUpdateResult | null> {
  // TODO: Implement
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
  const raceRes = await pool.query(
    `SELECT race_id FROM river_races WHERE guild_id = $1 AND clantag = $2 AND current_week = $3 AND (season_id = $4 OR season_id IS NULL)`,
    [guildId, clantag, warWeek, seasonId],
  );

  const oppClans = raceData.clans
    .map((clan) => ({ clantag: clan.tag, clan_name: clan.name }))
    .sort((a, b) => a.clantag.localeCompare(b.clantag));

  let raceId: number;

  if (raceRes.rows.length > 0) {
    raceId = raceRes.rows[0].race_id;
    await pool.query(
      `
      UPDATE river_races
      SET
        current_data = $1,
        last_check = NOW(),
        race_state = $2,
        current_day = $3,
        season_id = $4,
        opponent_clans = $5
      WHERE race_id = $6
    `,
      [JSON.stringify(raceData), raceData.periodType, warDay, seasonId, JSON.stringify(oppClans), raceId],
    );
    console.log('Updated race record for', clantag, raceId);
  } else {
    const result = await pool.query(
      `
      INSERT INTO river_races 
      (guild_id, clan_name,clantag, race_state, current_day, current_week, season_id, current_data, opponent_clans, last_check, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING race_id
      `,
      [
        guildId,
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
    console.log('Created new race record for', clantag, raceId);
  }

  // Update participant tracking with fresh data
  await updateParticipantTracking(raceId, guildId, raceData.clan.participants, clantag);

  return {
    raceId,
    raceData,
    seasonId,
    periodType: periodTypeMap[periodType] || periodType,
    warDay,
    warWeek,
  };
}

/**
 * Update participant tracking for a race.
 * Stores current state for each player in each clan (no cross-clan aggregation stored).
 *
 * @param raceId - Race ID
 * @param guildId - Discord guild ID
 * @param participants - Array of participants from API
 * @param clantag - Current clan tag
 */
export async function updateParticipantTracking(
  raceId: number,
  guildId: string,
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

  console.log(`[updateParticipantTracking] Called for clan ${clantag}, raceId ${raceId}`);
  console.log(`[updateParticipantTracking] Total participants received: ${participants.length}`);

  if (!participants || participants.length === 0) {
    console.log('No participants to track for', clantag);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get active tags
    const activeTags = participants.map((p) => p.tag);
    console.log(`[updateParticipantTracking] Active tags: ${activeTags.length}`, activeTags.slice(0, 5));

    const clanAttackMap = await client.query(
      `
      SELECT
        rpt.playertag,
        array_agg(DISTINCT rpt.clantag) as clans
      FROM race_participant_tracking rpt
      JOIN river_Races rr on rpt.race_id = rr.race_id
      WHERE rr.guild_id = $1
        AND rr.current_week = (SELECT current_week FROM river_races WHERE race_id = $2)
        AND rpt.playertag = ANY($3)
        AND rpt.decks_used > 0
      GROUP BY rpt.playertag
    `,
      [guildId, raceId, activeTags],
    );

    console.log(`[updateParticipantTracking] Clan attack map rows: ${clanAttackMap.rows.length}`);
    console.log('[updateParticipantTracking] Clan attack map:', clanAttackMap.rows);

    const playerClanMap = new Map<string, string[]>();
    for (const row of clanAttackMap.rows) {
      playerClanMap.set(row.playertag, row.clans);
    }

    // Build bulk upset values (multi-row insert)
    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const p of participants) {
      console.log(
        `[updateParticipantTracking] Processing ${p.name} (${p.tag}): decksUsed=${p.decksUsed}, decksUsedToday=${p.decksUsedToday}`,
      );

      // Skip if player hasn't attacked at all (either today or in previous war days)
      if (p.decksUsedToday === 0) continue;

      // get clans this player attacked in, ensure current clan included
      const clansAttacked = playerClanMap.get(p.tag) || [];
      if (!clansAttacked.includes(clantag)) {
        clansAttacked.push(clantag);
      }

      values.push(raceId, p.tag, p.name, clantag, p.fame, p.decksUsed, p.decksUsedToday, clansAttacked);
      placeholders.push(
        `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7})`,
      );
      paramIndex += 8;
    }

    console.log(`[updateParticipantTracking] Placeholders count: ${placeholders.length}`);
    console.log(`[updateParticipantTracking] Values array length: ${values.length}`);
    if (placeholders.length > 0) {
      // Single multi-row upsert
      await client.query(
        `
        INSERT into race_participant_tracking
          (race_id, playertag, player_name, clantag, fame, decks_used, decks_used_today, clans_attacked_in)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (race_id, playertag, clantag)
        DO UPDATE SET 
          player_name = EXCLUDED.player_name,
          fame = EXCLUDED.fame,
          decks_used = EXCLUDED.decks_used,
          decks_used_today = EXCLUDED.decks_used_today,
          clans_attacked_in = EXCLUDED.clans_attacked_in,
          last_updated = NOW()
        `,
        values,
      );
    }
    await client.query('COMMIT');
    console.log(`Updated participant tracking for ${participants.length} participants in clan ${clantag}`);
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
 * @param playerTags - Array of player tags to look up
 * @returns Map of playerTag -> userId
 */
export async function getLinkedPlayers(guildId: string, playerTags: string[]): Promise<Map<string, string>> {
  // TODO: Implement
  // Join users_playertags table to get discord user_ids
  // Return as Map for easy lookup

  const linkedPlayers = new Map<string, string>();

  const result = await pool.query(
    `SELECT playertag, user_id FROM users_playertags WHERE guild_id = $1 AND playertag = ANY($2)`,
    [guildId, playerTags],
  );

  for (const row of result.rows) {
    linkedPlayers.set(row.playertag, row.user_id);
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
  console.log(raceData.periodType, raceData.periodIndex);
  switch (raceData.periodType) {
    case 'training':
      return (raceData.periodIndex % 7) + 1;
    default:
      return (raceData.periodIndex % 7) - 2;
  }
}
