/**
 * Clan Change Comparator
 *
 * Compares two clan snapshots and detects changes:
 * - Members joining/leaving
 * - Role changes (promotion/demotion)
 * - Clan property changes (name, description, required trophies, etc.)
 */

import { ClanChange } from './types.js';
import logger from '../../logger.js';
import { Clan } from '../../api/CR_API.js';

// Type for clan member from API
type ClanMember = {
  tag: string;
  name: string;
  role?: string;
  arena?: { name: string; [key: string]: unknown };
  trophies?: number;
  [key: string]: unknown;
};

/**
 * Compare two clan snapshots and detect all changes
 *
 * @param oldSnapshot - Previous clan snapshot (null if first check)
 * @param newSnapshot - Current clan snapshot from API
 * @returns Array of detected changes
 */
export function detectClanChanges(oldSnapshot: Clan | null, newSnapshot: Clan): ClanChange[] {
  const changes: ClanChange[] = [];

  // If no old snapshot exists, this is the first check - don't log all existing members
  if (!oldSnapshot) {
    return changes;
  }

  try {
    // Detect member changes
    const memberChanges = detectMemberChanges(
      oldSnapshot.memberList,
      newSnapshot.memberList,
      newSnapshot.name,
      newSnapshot.tag,
      newSnapshot.badgeId,
      newSnapshot.members,
      newSnapshot.clanWarTrophies,
    );
    changes.push(...memberChanges);

    // Detect clan property changes
    const propertyChanges = detectPropertyChanges(oldSnapshot, newSnapshot);
    changes.push(...propertyChanges);
  } catch (error) {
    logger.error('[ClanComparator] Error detecting changes:', error);
  }

  return changes;
}

/**
 * Detect member-related changes (joins, leaves, role changes)
 */
function detectMemberChanges(
  oldMembers: ClanMember[],
  newMembers: ClanMember[],
  clanName: string,
  clantag: string,
  badgeId: number,
  members: number,
  clanScore: number,
): ClanChange[] {
  const changes: ClanChange[] = [];

  // Create maps for efficient lookup
  const oldMemberMap = new Map(oldMembers.map((m) => [m.tag, m]));
  const newMemberMap = new Map(newMembers.map((m) => [m.tag, m]));

  // Detect removed members (leaves)
  for (const oldMember of oldMembers) {
    if (!newMemberMap.has(oldMember.tag)) {
      const role = oldMember.role || 'member';
      changes.push({
        type: 'member_leave',
        clanName,
        clantag,
        badgeId,
        members,
        clanScore,
        playertag: oldMember.tag,
        playerName: oldMember.name,
        role: role,
        arena: oldMember.arena || { name: 'GoblinStadium' },
        trophies: oldMember.trophies || 0,
        oldRole: role,
      });
    }
  }

  // Detect new members (joins)
  for (const newMember of newMembers) {
    if (!oldMemberMap.has(newMember.tag)) {
      const role = newMember.role || 'member';
      changes.push({
        type: 'member_join',
        clanName,
        clantag,
        badgeId,
        members,
        clanScore,
        playertag: newMember.tag,
        playerName: newMember.name,
        role: role,
        arena: newMember.arena || { name: 'GoblinStadium' },
        trophies: newMember.trophies || 0,
        newRole: role,
      });
    }
  }

  // Detect role changes for existing members
  for (const newMember of newMembers) {
    const oldMember = oldMemberMap.get(newMember.tag);
    if (oldMember && oldMember.role !== newMember.role) {
      changes.push({
        type: 'role_change',
        clanName,
        clantag,
        badgeId,
        members,
        clanScore,
        playertag: newMember.tag,
        playerName: newMember.name,
        arena: newMember.arena || { name: 'GoblinStadium' },
        trophies: newMember.trophies || 0,
        oldRole: oldMember.role || 'member',
        newRole: newMember.role || 'member',
      });
    }
  }

  return changes;
}

/**
 * Detect clan property changes (name, description, required trophies, etc.)
 */
function detectPropertyChanges(oldClan: Clan, newClan: Clan): ClanChange[] {
  const changes: ClanChange[] = [];

  // Check clan name
  if (oldClan.name !== newClan.name) {
    changes.push({
      type: 'clan_property_change',
      clanName: newClan.name,
      clantag: newClan.tag,
      description: newClan.description,
      badgeId: newClan.badgeId,
      members: newClan.members,
      clanScore: newClan.clanWarTrophies,
      location: newClan.location,
      property: 'name',
      oldValue: oldClan.name,
      newValue: newClan.name,
    });
  }

  // Check description
  if (oldClan.description !== newClan.description) {
    changes.push({
      type: 'clan_property_change',
      clanName: newClan.name,
      clantag: newClan.tag,
      description: newClan.description,
      badgeId: newClan.badgeId,
      members: newClan.members,
      clanScore: newClan.clanWarTrophies,
      location: newClan.location,
      property: 'description',
      oldValue: oldClan.description,
      newValue: newClan.description,
    });
  }

  // Check required trophies
  if (oldClan.requiredTrophies !== newClan.requiredTrophies) {
    changes.push({
      type: 'clan_property_change',
      clanName: newClan.name,
      clantag: newClan.tag,
      description: newClan.description,
      badgeId: newClan.badgeId,
      members: newClan.members,
      clanScore: newClan.clanWarTrophies,
      location: newClan.location,
      property: 'requiredTrophies',
      oldValue: String(oldClan.requiredTrophies),
      newValue: String(newClan.requiredTrophies),
    });
  }

  // Check clan war trophies
  if (oldClan.clanWarTrophies !== newClan.clanWarTrophies) {
    changes.push({
      type: 'clan_property_change',
      clanName: newClan.name,
      clantag: newClan.tag,
      description: newClan.description,
      badgeId: newClan.badgeId,
      members: newClan.members,
      clanScore: newClan.clanWarTrophies,
      location: newClan.location,
      property: 'clanWarTrophies',
      oldValue: String(oldClan.clanWarTrophies),
      newValue: String(newClan.clanWarTrophies),
    });
  }

  // Check type (open/invite only/closed)
  if (oldClan.type !== newClan.type) {
    changes.push({
      type: 'clan_property_change',
      clanName: newClan.name,
      clantag: newClan.tag,
      description: newClan.description,
      badgeId: newClan.badgeId,
      members: newClan.members,
      clanScore: newClan.clanWarTrophies,
      location: newClan.location,
      property: 'type',
      oldValue: String(oldClan.type),
      newValue: String(newClan.type),
    });
  }

  // Check location
  if (oldClan.location.name !== newClan.location.name) {
    changes.push({
      type: 'clan_property_change',
      clanName: newClan.name,
      clantag: newClan.tag,
      description: newClan.description,
      badgeId: newClan.badgeId,
      members: newClan.members,
      clanScore: newClan.clanWarTrophies,
      location: newClan.location,
      property: 'location',
      oldValue: oldClan.location.name,
      newValue: newClan.location.name,
    });
  }

  // Check badge ID
  if (oldClan.badgeId !== newClan.badgeId) {
    changes.push({
      type: 'clan_property_change',
      clanName: newClan.name,
      clantag: newClan.tag,
      description: newClan.description,
      badgeId: newClan.badgeId,
      members: newClan.members,
      clanScore: newClan.clanWarTrophies,
      location: newClan.location,
      property: 'badgeId',
      oldValue: String(oldClan.badgeId),
      newValue: String(newClan.badgeId),
    });
  }

  return changes;
}
