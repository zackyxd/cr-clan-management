/**
 * Types for clan activity logging feature
 */

import type { Clan } from '../../api/CR_API.js';

/**
 * Represents a detected change in clan data
 * Uses discriminated union for type-safe access to properties
 */
export type ClanChange =
  | {
      type: 'member_join';
      clanName: string;
      badgeId: number;
      members: number;
      clanScore: number;
      playertag: string;
      playerName: string;
      role: string;
      clantag: string;
      arena: { rawName: string };
      trophies: number;
      newRole: string;
    }
  | {
      type: 'member_leave';
      clanName: string;
      badgeId: number;
      members: number;
      clanScore: number;
      playertag: string;
      playerName: string;
      role: string;
      clantag: string;
      arena: { rawName: string };
      trophies: number;
      oldRole: string;
    }
  | {
      type: 'role_change';
      clanName: string;
      badgeId: number;
      members: number;
      clanScore: number;
      playertag: string;
      playerName: string;
      clantag: string;
      arena: { rawName: string };
      trophies: number;
      oldRole: string;
      newRole: string;
    }
  | {
      type: 'clan_property_change';
      clanName: string;
      description: string;
      badgeId: number;
      members: number;
      clanScore: number;
      property: string;
      location: { name: string };
      oldValue: string | number;
      newValue: string | number;
      clantag: string;
    };

/**
 * Type helper to extract the change type from ClanChange
 */
export type ClanChangeType = ClanChange['type'];

/**
 * Clan data for activity checking (from database query)
 */
export interface ClanActivityData {
  guild_id: string;
  clantag: string;
  clan_name: string;
  clan_role_id: string | null;
  clan_logs_channel_id: string;
  clan_logs_manage_roles: boolean;
  clan_logs_add_role: boolean;
  clan_logs_remove_role: boolean;
  last_activity_snapshot: Clan | null;
  last_activity_check_at: Date | null;
}
