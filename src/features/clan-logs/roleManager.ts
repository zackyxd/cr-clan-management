/**
 * Clan Role Manager
 *
 * Handles automatic Discord role assignment/removal for clan members
 * based on join/leave events detected from the Clash Royale API
 */

import { Client } from 'discord.js';
import { pool } from '../../db.js';
import { ClanChange } from './types.js';
import logger from '../../logger.js';

/**
 * Handle role changes for clan members based on detected activity
 *
 * @param client - Discord client
 * @param guildId - Discord server ID
 * @param clantag - Clan tag
 * @param clanRoleId - Discord role ID to manage
 * @param changes - Detected clan changes
 * @param addRole - Whether to add role on join
 * @param removeRole - Whether to remove role on leave
 * @param requiredRoleId - Guild-wide required role before users can receive clan roles
 */
export async function handleRoleChanges(
  client: Client,
  guildId: string,
  _clantag: string,
  clanRoleId: string | null,
  changes: ClanChange[],
  addRole: boolean,
  removeRole: boolean,
  requiredRoleId: string | null = null,
): Promise<void> {
  // Skip if role management is disabled or no role is set
  if (!clanRoleId || (!addRole && !removeRole)) {
    return;
  }

  try {
    // Get the guild
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      logger.warn(`[ClanRoleManager] Guild ${guildId} not found`);
      return;
    }

    // Get the role
    const role = await guild.roles.fetch(clanRoleId).catch(() => null);
    if (!role) {
      logger.warn(`[ClanRoleManager] Role ${clanRoleId} not found in guild ${guildId}`);
      return;
    }

    // Process joins (add role)
    if (addRole) {
      const joins = changes.filter((c) => c.type === 'member_join');
      for (const change of joins) {
        if (change.playertag) {
          await addRoleToLinkedMember(guild.id, change.playertag, role.id, client, requiredRoleId);
        }
      }
    }

    // Process leaves (remove role)
    if (removeRole) {
      const leaves = changes.filter((c) => c.type === 'member_leave');
      for (const change of leaves) {
        if (change.playertag) {
          await removeRoleFromLinkedMember(guild.id, change.playertag, role.id, client);
        }
      }
    }
  } catch (error) {
    logger.error('[ClanRoleManager] Error handling role changes:', error);
  }
}

/**
 * Add clan role to a linked Discord member
 */
async function addRoleToLinkedMember(
  guildId: string,
  playertag: string,
  roleId: string,
  client: Client,
  requiredRoleId: string | null = null,
): Promise<void> {
  try {
    // Find linked Discord user
    const result = await pool.query(`SELECT discord_id FROM user_playertags WHERE playertag = $1`, [playertag]);

    if (result.rows.length === 0) {
      return;
    }

    const discordId = result.rows[0].discord_id;

    // Get guild and member (use cache first for speed)
    const guild = await client.guilds.fetch(guildId);
    let member = await guild.members.fetch(discordId).catch(() => null);

    if (!member) {
      return;
    }

    // Check if user has required role (if configured)
    if (requiredRoleId && !member.roles.cache.has(requiredRoleId)) {
      // Cache says they don't have it, but they joined the clan - double check with fresh fetch
      member = await guild.members.fetch({ user: discordId, force: true }).catch(() => null);
      if (!member || !member.roles.cache.has(requiredRoleId)) {
        return;
      }
    }

    // Add role if not already present
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId);
    }
  } catch (error) {
    logger.error(`[ClanRoleManager] Error adding role for player ${playertag}:`, error);
  }
}

/**
 * Remove clan role from a linked Discord member
 */
async function removeRoleFromLinkedMember(
  guildId: string,
  playertag: string,
  roleId: string,
  client: Client,
): Promise<void> {
  try {
    // Find linked Discord user
    const result = await pool.query(`SELECT discord_id FROM user_playertags WHERE playertag = $1`, [playertag]);

    if (result.rows.length === 0) {
      return;
    }

    const discordId = result.rows[0].discord_id;

    // Get guild and member (cache is fine for removal)
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(discordId).catch(() => null);

    if (!member) {
      return;
    }

    // Remove role if present
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
    }
  } catch (error) {
    logger.error(`[ClanRoleManager] Error removing role for player ${playertag}:`, error);
  }
}
