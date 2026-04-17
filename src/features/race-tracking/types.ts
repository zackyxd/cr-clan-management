/**
 * TypeScript type definitions for race tracking feature
 */

import { CurrentRiverRace } from '../../api/CR_API.js';

// Database row types
export interface RiverRace {
  race_id: number;
  clan_tag: string;
  guild_id: string;
  end_time: Date | null;
  race_state: string | null; // 'training', 'warDay', 'colosseum'
  current_day: number; // 0 = training, 1-4 = war days
  season_id: number | null;
  section_index: number;
  last_check: Date | null;
  previous_decks_used_today: number;
  current_data: CurrentRiverRace | null;
  opponent_clans: Array<{
    tag: string;
    name: string;
  }> | null;
  created_at: Date;
}

export interface RaceUpdateResult {
  raceId: number;
  raceData: CurrentRiverRace;
  seasonId: number | null;
  periodType: string;
  warDay: number;
  warWeek: number;
}

/**
 * Participant tracking stores CURRENT state only (not historical per-day).
 * When a day rolls over, we save a snapshot then reset decks_used_today.
 *
 * total_decks_today_all_clans is computed dynamically via SQL query, not stored.
 *
 * Example over 2 days:
 * - Day 1: Player does 4 attacks → decks_used=4, decks_used_today=4
 * - Rollover: Save snapshot, reset
 * - Day 2: Player does 3 attacks → decks_used=7, decks_used_today=3
 *
 * For historical "who attacked on day X", query race_day_snapshots.
 */
export interface RaceParticipant {
  tracking_id: number;
  race_id: number;
  player_tag: string;
  player_name: string;
  clan_tag: string;
  clan_name: string;
  current_day: number; // Race day (0=training, 1-4=war days)
  fame: number;
  decks_used: number; // Cumulative total for entire race
  decks_used_today: number; // Today's attacks only (resets on rollover)
  clans_attacked_in: string[]; // Clan tags where they have decks_used >= 1
  clan_names_attacked_in: string[]; // Clan names where they have decks_used >= 1
  last_updated: Date;
}

export interface RaceDaySnapshot {
  snapshot_id: number;
  race_id: number;
  race_day: number;
  snapshot_time: Date;
  snapshot_data: SnapshotData; // Complete snapshot with raw + computed data
}

// Complete snapshot data structure
export interface SnapshotData {
  rawApiData: any; // Raw CurrentRiverRace response for debugging/recomputation
  embedData: SnapshotEmbedData; // Pre-computed embed display data
}

// Snapshot embed data - stores exactly what was displayed at rollover
export interface SnapshotEmbedData {
  // Attacks embed data (copy of what /attacks showed)
  attacks: {
    clanName: string;
    clantag: string;
    seasonId: number | null;
    warWeek: number;
    raceDay: number;
    availableAttackers: number;
    totalAttacksRemaining: number;
    groups: Array<{
      attacksRemaining: number;
      count: number;
      players: Array<{
        name: string;
        emojis: string[]; // Status indicators: '☠️', '🚫', '⚠️', '⏰', '❌'
        clansAttackedIn?: string[]; // Only if split attacker or wrong clan
      }>;
    }>;
    legend: string[]; // Footer legend items actually shown
  };
  // Race stats embed data (what /race showed) - optional depending on race type
  race?: {
    periodType: 'Training' | 'War Day' | 'Colosseum';
    clanName: string;
    totalFame: number;
    totalDecksUsed: number;
    totalDecksUsedToday: number;
    rank?: number;
    projectedRank?: string;
    // Can add more fields as /race gets implemented
  };
}

export interface RaceNudge {
  nudge_id: number;
  race_id: number;
  clan_tag: string;
  race_day: number;
  nudge_time: Date;
  nudge_type: 'automatic' | 'manual';
  custom_message: string | null;
  players_nudged: string[];
}

// Service layer return types
export interface RaceAttacksData {
  clanInfo: {
    clantag: string;
    name: string;
    fame: number;
    totalDecksUsed: number;
    totalDecksUsedToday: number;
  };
  participants: ParticipantWithAttacks[];
  totalAttacksRemaining: number;
  availableAttackers: number; // 50 - number who attacked
  raceDay: number;
  raceState: string;
  seasonId: number | null;
  warWeek: number;
}

export interface ParticipantWithAttacks {
  playertag: string;
  playerName: string;
  attacksUsedToday: number;
  attacksRemaining: number;
  fame: number;
  totalDecksUsed: number;
  clantag: string; // The clan where this participant entry was recorded
  clanName: string; // The clan name where this participant entry was recorded
  clansAttackedIn: string[]; // Array of clan names if split attacks
  isSplitAttacker: boolean; // True if attacked in multiple clans
  isInClan: boolean; // True if player is currently in the clan (based on clan member list)
  hasAttackedElsewhere: boolean; // True if player is in clan but attacked in another clan
  isReplacementPlayer?: boolean; // Marked as "replace me"
  isAttackingLate?: boolean; // Marked as "attacking late"
  discordUserId?: string; // If player is linked
}

export type RaceStatsData = TrainingStatsData | WarDayStatsData | ColosseumStatsData;

interface TrainingStatsData {
  type: 'training';
  day: number;
  week: number;
  clans: Array<{
    clantag: string;
    name: string;
    fame: number;
    participantCount: number;
    attacksUsedToday: number;
  }>;
}

interface WarDayStatsData {
  type: 'warDay';
  day: number;
  week: number;
  clans: Array<{
    clantag: string;
    name: string;
    rank: number;
    fame: number;
    boatPoints: number;
    participantCount: number;
    attacksUsedToday: number;
    projectedFame: number;
    projectedRank: string;
  }>;
}

interface ColosseumStatsData {
  type: 'colosseum';
  day: number;
  week: number;
  clans: Array<{
    clantag: string;
    name: string;
    // rank: number;
    // trophies: number; // Different from fame
    fame: number;
    participantCount: number;
    attacksUsedToday: number;
    projectedFame: number;
    projectedRank: string;
  }>;
}

export interface RaceHistoryData {
  raceDay: number;
  snapshotTime: Date;
  clanInfo: {
    tag: string;
    name: string;
    fame: number;
  };
  participants: Array<{
    playerTag: string;
    playerName: string;
    fame: number;
    decksUsed: number;
    decksUsedToday: number;
  }>;
}
