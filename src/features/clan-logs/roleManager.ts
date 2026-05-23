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
 */
export async function handleRoleChanges(
  client: Client,
  guildId: string,
  _clantag: string,
  clanRoleId: string | null,
  changes: ClanChange[],
  addRole: boolean,
  removeRole: boolean,
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
          await addRoleToLinkedMember(guild.id, change.playertag, role.id, client);
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
  playerTag: string,
  roleId: string,
  client: Client,
): Promise<void> {
  try {
    // Find linked Discord user
    const result = await pool.query(`SELECT discord_id FROM user_playertags WHERE playertag = $1`, [playerTag]);

    if (result.rows.length === 0) {
      logger.debug(`[ClanRoleManager] Player ${playerTag} is not linked to any Discord account`);
      return;
    }

    const discordId = result.rows[0].discord_id;

    // Get guild and member
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(discordId).catch(() => null);

    if (!member) {
      logger.debug(`[ClanRoleManager] Discord user ${discordId} is not in guild ${guildId}`);
      return;
    }

    // Add role if not already present
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId);
      logger.info(`[ClanRoleManager] Added role ${roleId} to ${member.user.tag} (${playerTag})`);
    }
  } catch (error) {
    logger.error(`[ClanRoleManager] Error adding role for player ${playerTag}:`, error);
  }
}

/**
 * Remove clan role from a linked Discord member
 */
async function removeRoleFromLinkedMember(
  guildId: string,
  playerTag: string,
  roleId: string,
  client: Client,
): Promise<void> {
  try {
    // Find linked Discord user
    const result = await pool.query(`SELECT discord_id FROM user_playertags WHERE playertag = $1`, [playerTag]);

    if (result.rows.length === 0) {
      logger.debug(`[ClanRoleManager] Player ${playerTag} is not linked to any Discord account`);
      return;
    }

    const discordId = result.rows[0].discord_id;

    // Get guild and member
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(discordId).catch(() => null);

    if (!member) {
      logger.debug(`[ClanRoleManager] Discord user ${discordId} is not in guild ${guildId}`);
      return;
    }

    // Remove role if present
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      logger.info(`[ClanRoleManager] Removed role ${roleId} from ${member.user.tag} (${playerTag})`);
    }
  } catch (error) {
    logger.error(`[ClanRoleManager] Error removing role for player ${playerTag}:`, error);
  }
}
