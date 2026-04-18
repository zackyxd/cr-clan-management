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

export const periodTypeMap: { [key: string]: string } = {
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
 * @param raceData - Current river race data from API
 * @param seasonId - Season ID
 * @param warWeek - War week number
 * @returns Processed attack data ready for display
 */
export async function getRaceAttacks(
  guildId: string,
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

  // Get cross-clan attack totals from DB
  const playertags = activeMembers.map((m) => m.tag);

  const attacksQuery = await pool.query(
    `
    SELECT 
      rpt.playertag,
      rpt.player_name,
      rpt.clans_attacked_in,
      rpt.clan_names_attacked_in,
      u.is_replace_me,
      u.is_attacking_late,
      up.discord_id,
      -- Compute total across all guild clans FOR CURRENT DAY ONLY
      (SELECT COALESCE(SUM(rpt2.decks_used_today), 0)
       FROM race_participant_tracking rpt2
       JOIN river_races rr2 ON rpt2.race_id = rr2.race_id
       WHERE rpt2.playertag = rpt.playertag
         AND rr2.guild_id = $1
         AND rr2.current_week = (SELECT current_week FROM river_races WHERE clantag = $2 AND guild_id = $1 LIMIT 1)
         AND rpt2.current_day = (SELECT current_day FROM river_races WHERE clantag = $2 AND guild_id = $1 LIMIT 1)
      ) as total_attacks
    FROM race_participant_tracking rpt
    JOIN river_races rr ON rpt.race_id = rr.race_id
    LEFT JOIN user_playertags up ON rpt.playertag = up.playertag AND up.guild_id = $1
    LEFT JOIN users u ON up.discord_id = u.discord_id AND u.guild_id = $1
    WHERE rr.guild_id = $1
      AND rr.clantag = $2
      AND rpt.playertag = ANY($3)
      AND rpt.current_day = (SELECT current_day FROM river_races WHERE clantag = $2 AND guild_id = $1 LIMIT 1)
  `,
    [guildId, raceData.clan.tag, playertags],
  );

  // Build map of player attack data
  const playerAttackMap = new Map<
    string,
    {
      totalDecks: number;
      clansAttackedIn: string[];
      clanNamesAttackedIn: string[];
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
      isReplacementPlayer: row.is_replace_me || false,
      isAttackingLate: row.is_attacking_late || false,
      discordId: row.discord_id || null,
    });
  }

  // Include ALL active members (those who haven't done 4 attacks OR split attacks across clans)
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
        clansAttackedIn: clansAttackedNames,
        isSplitAttacker: clantagsAttacked.length > 1,
        isInClan,
        hasAttackedElsewhere,
        isReplacementPlayer: attackData?.isReplacementPlayer || false,
        isAttackingLate: attackData?.isAttackingLate || false,
        discordUserId: attackData?.discordId || undefined,
      };
    })
    .filter((p) => p.attacksRemaining > 0 || p.isSplitAttacker || p.hasAttackedElsewhere); // Show if incomplete OR split attacker OR wrong clan

  // Sort by attacks remaining (most needed first), then alphabetically by name
  const participants = playersNeedingAttacks.sort((a, b) => {
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
      const average = clan.fame / (attacksUsedToday + totalDecksUsed);
      const projectedFameRaw =
        clan.fame + Math.round(200 * (4 - warDay) * average) + Math.round((200 - attacksUsedToday) * average);
      const projectedFame = Math.round(projectedFameRaw / 50) * 50;

      return {
        clantag: clan.tag,
        name: clan.name,
        fame: clan.fame,
        participantCount: clan.participants.filter((p) => p.decksUsedToday > 0).length,
        attacksUsedToday,
        projectedFame,
      };
    });

    // Sort by projected fame descending
    const sorted = clansWithProjected.sort((a, b) => b.projectedFame - a.projectedFame);

    // Add ranks
    return {
      type: 'colosseum',
      day: warDay,
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
    const average = (clan.periodPoints ?? 0) / attacksUsedToday;
    const projectedFameRaw = (clan.periodPoints ?? 0) + Math.round((200 - attacksUsedToday) * average);
    const projectedFame = Math.round(projectedFameRaw / 50) * 50;

    return {
      clantag: clan.tag,
      name: clan.name,
      fame: clan.periodPoints ?? 0,
      boatPoints: clan.fame,
      participantCount: clan.participants.filter((p) => p.decksUsedToday > 0).length,
      attacksUsedToday,
      projectedFame,
    };
  });

  // Sort by projected fame descending for ranking
  const sortedByProjected = [...clansWithProjected].sort((a, b) => b.projectedFame - a.projectedFame);

  // Also sort by current fame for current rank
  const sortedByFame = [...clansWithProjected].sort((a, b) => {
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

      // Check if snapshot already exists
      const existing = await client.query(
        `SELECT snapshot_id FROM race_day_snapshots WHERE race_id = $1 AND race_day = $2`,
        [raceId, day],
      );

      if (existing.rows.length > 0) {
        console.log(`[Snapshot] Snapshot already exists for race ${raceId} day ${day}`);
        await client.query('ROLLBACK');
        return false;
      }

      // Get the attacks data (what /attacks would show)
      const attacksData = await getRaceAttacks(guildId, raceData, seasonId, warWeek);
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

      // Group participants by attacks remaining (same as /attacks command)
      const grouped = new Map<number, typeof attacksData.participants>();
      for (const p of attacksData.participants) {
        const key = p.attacksRemaining;
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(p);
      }

      // Build groups array for snapshot
      const groups = Array.from(grouped.entries())
        .sort((a, b) => b[0] - a[0]) // Sort by attacks remaining descending
        .map(([attacksRemaining, players]) => ({
          attacksRemaining,
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

      console.log(raceStatsData);
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

      // Store snapshot
      await client.query(
        `
        INSERT INTO race_day_snapshots
        (race_id, race_day, snapshot_time, snapshot_data)
        VALUES ($1, $2, NOW(), $3)
      `,
        [raceId, day, JSON.stringify(snapshotData)],
      );

      await client.query('COMMIT');
      console.log(`[Snapshot] Created snapshot for race ${raceId} day ${day} with ${groups.length} groups`);
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

    // Get the existing race data to detect rollover
    const existingRace = await pool.query(`SELECT current_day, current_data FROM river_races WHERE race_id = $1`, [
      raceId,
    ]);

    const oldDay = existingRace.rows[0]?.current_day || 0;
    const oldRaceData = existingRace.rows[0]?.current_data;

    // Detect day rollover using isNewWarDay function
    if (oldRaceData && isNewWarDay(oldRaceData, raceData)) {
      console.log(`[Rollover] Day rollover detected for ${clantag}: Day ${oldDay} → Day ${oldDay + 1}`);

      // Create snapshot BEFORE updating to preserve old day's data
      await createDaySnapshot(raceId, guildId, oldRaceData, seasonId, warWeek, oldDay);
    }

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
      JOIN river_Races rr on rpt.race_id = rr.race_id
      WHERE rr.guild_id = $1
        AND rr.current_week = (SELECT current_week FROM river_races WHERE race_id = $2)
        AND rpt.current_day = (SELECT current_day FROM river_races WHERE race_id = $2)
        AND rpt.playertag = ANY($3)
        AND rpt.decks_used_today > 0
      GROUP BY rpt.playertag
    `,
      [guildId, raceId, activeTags],
    );

    const playerClanMap = new Map<string, { tags: string[]; names: string[] }>();
    for (const row of clanAttackMap.rows) {
      playerClanMap.set(row.playertag, {
        tags: row.clans || [],
        names: row.clan_names || [],
      });
    }

    // Build bulk upset values (multi-row insert)
    const values: any[] = [];
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
      return (raceData.periodIndex % 7) + 1;
    default:
      return (raceData.periodIndex % 7) - 2;
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
  // TODO: Implement day rollover detection logic
  // Compare newRaceData vs previousRaceData to detect if day changed
  // Consider: periodIndex changes, decksUsedToday resets, etc.
  console.log('Checking for new war day...');

  let oldAttacks = 0;
  let newAttacks = 0;
  for (const clan of previousRaceData.clans) {
    oldAttacks += clan.participants.reduce((sum, p) => sum + p.decksUsedToday, 0);
  }
  for (const clan of newRaceData.clans) {
    newAttacks += clan.participants.reduce((sum, p) => sum + p.decksUsedToday, 0);
  }

  if (newAttacks - oldAttacks === 0) {
    // No change in attacks, check if periodIndex changed (handles edge case of no attacks for any clan)
    if (newRaceData.periodIndex !== previousRaceData.periodIndex) {
      return true;
    } else {
      return false;
    }
  }

  return newAttacks < oldAttacks;
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
