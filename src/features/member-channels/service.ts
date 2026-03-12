import { ChannelType, Guild, PermissionFlagsBits } from 'discord.js';
import { CR_API, FetchError, isFetchError, normalizeTag, Player, PlayerResult } from '../../api/CR_API.js';
import { pool } from '../../db.js';
import { buildGetLinkedDiscordIds, buildGetLinkedPlayertags } from '../../sql_queries/users.js';
import {
  buildPermissionOverwrites,
  convertToMemberData,
  insertMemberChannel,
} from '../../utils/memberChannelHelpers.js';
import type {
  ChannelCreationInput,
  ParsedChannelInput,
  DatabaseLookupResult,
  CategorizedAccounts,
  AccountSelection,
  FinalChannelData,
  MemberChannelSession,
  PlayerInfo,
  ClanInfo,
} from './types.js';
import { SESSION_CLEANUP_INTERVAL_MINUTES, SESSION_EXPIRY_MINUTES } from '../../config/constants.js';

/**
 * Service for managing member channel creation workflow
 */
export class MemberChannelService {
  private sessions = new Map<string, MemberChannelSession>();

  // ============================================================================
  // STEP 3: Receive and validate initial input
  // ============================================================================

  /**
   * Start a new member channel creation session
   * This is called when the user submits the initial modal
   */
  async startChannelCreation(guildId: string, creatorId: string, input: ChannelCreationInput): Promise<string> {
    const sessionId = `${guildId}_${creatorId}_${Date.now()}`;
    const { channelName } = input;
    // Validate channel name (max 25 chars)
    if (!channelName || channelName.length > 25 || channelName.length < 1) {
      throw new Error('Channel name must be 1-25 characters.');
    }
    // Parse playertags and discord ids
    const parsed = this.parseInput(input);

    // Lookup database for linked accounts (Step 5-6)
    const dbResults = await this.lookupDatabase(guildId, parsed);

    // Categorize accounts (Step 7-8)
    const categorized = this.categorizeAccounts(dbResults, parsed);

    // Create session
    const session: MemberChannelSession = {
      id: sessionId,
      guildId,
      creatorId,
      step: 'account_selection',
      input: parsed,
      invalidPlayertags: dbResults.invalidPlayertags,
      invalidDiscordIds: dbResults.invalidDiscordIds,
      categorized,
      selections: new Map(),
      multipleAccountUserIds: Array.from(categorized.multipleAccountUsers.keys()),
      currentUserIndex: 0,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.sessions.set(sessionId, session);
    // console.log(`Session created!:`, session);
    return sessionId;
  }

  // ============================================================================
  // STEP 4: Parse and normalize input
  // ============================================================================

  /**
   * Parse raw input strings into clean arrays
   */
  private parseInput(input: ChannelCreationInput): ParsedChannelInput {
    // Split playertags by whitespace/commas
    const playertagArray = Array.from(
      new Set(
        input.playertags
          .split(/[\s,]+/)
          .map((tag) => normalizeTag(tag.trim()))
          .filter((tag) => tag.length > 0),
      ),
    );

    // Split discord ids by whitespace
    // Handle mention format <@123> and extract just the ID
    // Remove duplicates
    const discordIdArray = Array.from(
      new Set(
        input.discordIds
          .split(/\s+/)
          .map((id) => {
            // Remove mention formatting: <@123>, <@!123>
            const match = id.match(/^<@!?(\d+)>$/);
            return match ? match[1] : id.trim();
          })
          .filter((id) => id.length > 0),
      ),
    );

    console.log(playertagArray, discordIdArray);

    return {
      channelName: input.channelName.trim(),
      playertagArray,
      discordIdArray,
    };
  }

  // ============================================================================
  // STEP 5-6: Database lookups
  // ============================================================================

  /**
   * Query database to find:
   * - Which discord IDs own the inputted playertags
   * - Which playertags are linked to the inputted discord IDs
   */
  private async lookupDatabase(guildId: string, parsed: ParsedChannelInput): Promise<DatabaseLookupResult> {
    const playertagToDiscordId = new Map<string, string>();
    const discordIdToPlayertags = new Map<string, string[]>();

    // Query database for playertag -> discord_id mapping (only if playertags provided)
    if (parsed.playertagArray.length > 0) {
      const sql = buildGetLinkedDiscordIds(guildId, parsed.playertagArray);
      const res = await pool.query(sql);
      res.rows.forEach((row: { discord_id: string; playertag: string }) => {
        playertagToDiscordId.set(row.playertag, row.discord_id);
      });
    }

    // Query database for discord_id -> playertag[] mapping (only if discord IDs provided)
    if (parsed.discordIdArray.length > 0) {
      const sql = buildGetLinkedPlayertags(guildId, parsed.discordIdArray);
      const res = await pool.query(sql);
      res.rows.forEach((row: { discord_id: string; playertag: string }) => {
        if (!discordIdToPlayertags.has(row.discord_id)) {
          discordIdToPlayertags.set(row.discord_id, []);
        }
        discordIdToPlayertags.get(row.discord_id)!.push(row.playertag);
      });
    }

    // Identify invalid entries by comparing input vs found entries
    const invalidPlayertags = parsed.playertagArray.filter((tag) => !playertagToDiscordId.has(tag));
    const invalidDiscordIds = parsed.discordIdArray.filter((discordId) => !discordIdToPlayertags.has(discordId));

    return {
      playertagToDiscordId,
      discordIdToPlayertags,
      invalidPlayertags,
      invalidDiscordIds,
    };
  }

  // ============================================================================
  // STEP 7-8: Categorize accounts
  // ============================================================================

  /**
   * Categorize accounts into:
   * - finalAccounts: From playertag input (no selection needed)
   * - singleAccountUsers: Discord IDs with only 1 account
   * - multipleAccountUsers: Discord IDs with 2+ accounts (need selection)
   */
  private categorizeAccounts(dbResults: DatabaseLookupResult, parsed: ParsedChannelInput): CategorizedAccounts {
    const finalAccounts = new Map<string, string[]>();
    const singleAccountUsers = new Map<string, string>();
    const multipleAccountUsers = new Map<string, string[]>();

    // Step 1: Add all playertags explicitly chosen via playertag input
    if (dbResults.playertagToDiscordId.size > 0) {
      dbResults.playertagToDiscordId.forEach((discordId, playertag) => {
        if (!finalAccounts.has(discordId)) {
          finalAccounts.set(discordId, []);
        }
        finalAccounts.get(discordId)!.push(playertag);
      });
    }

    // Step 2: Process discord IDs from discord ID input
    if (dbResults.discordIdToPlayertags.size > 0) {
      dbResults.discordIdToPlayertags.forEach((playertags, discordId) => {
        // Check if this user already has some tags selected from playertag input
        const alreadySelectedTags = finalAccounts.get(discordId) || [];

        if (playertags.length === 1) {
          // Single account user - auto-add if not already selected
          if (!alreadySelectedTags.includes(playertags[0])) {
            singleAccountUsers.set(discordId, playertags[0]);
          }
        } else if (playertags.length > 1) {
          // Multiple account user - filter out already selected tags
          const remainingTags = playertags.filter((tag) => !alreadySelectedTags.includes(tag));

          if (remainingTags.length === 0) {
            // All tags already selected, no need for selection
            console.log(`[categorizeAccounts] User ${discordId} - all tags already selected`);
          } else if (remainingTags.length === 1) {
            // Only one tag left, auto-add it
            if (!finalAccounts.has(discordId)) {
              finalAccounts.set(discordId, []);
            }
            finalAccounts.get(discordId)!.push(remainingTags[0]);
            console.log(
              `[categorizeAccounts] User ${discordId} - auto-selected last remaining tag: ${remainingTags[0]}`,
            );
          } else {
            // Multiple remaining tags, need user selection
            multipleAccountUsers.set(discordId, remainingTags);
            console.log(
              `[categorizeAccounts] User ${discordId} - needs selection for ${remainingTags.length} remaining tags`,
            );
          }
        }
      });
    }

    console.log(
      `[categorizeAccounts] Final: ${finalAccounts.size}, Single: ${singleAccountUsers.size}, Multiple: ${multipleAccountUsers.size}`,
    );

    return {
      finalAccounts,
      singleAccountUsers,
      multipleAccountUsers,
    };
  }

  // ============================================================================
  // STEP 9: Handle account selection for multiple account users
  // ============================================================================

  /**
   * Get data needed to show account selection UI for a specific user
   */
  async getAccountSelectionData(
    sessionId: string,
    userIndex: number,
  ): Promise<{
    discordId: string;
    players: { tag: string; name: string; expLevel: number }[];
    userIndex: number;
    totalUsers: number;
  } | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Get the discord ID for this user index
    const discordId = session.multipleAccountUserIds[userIndex];

    // Get their playertags from categorized.multipleAccountUsers Map
    const playertags = session.categorized.multipleAccountUsers.get(discordId);
    if (!playertags) {
      return null;
    }

    // Fetch player data from CR API for each playertag
    const playerResults = await Promise.all(playertags.map((tag) => CR_API.getPlayer(tag)));

    // Filter out errors and extract player info
    const players = playerResults
      .filter((result): result is Player => !isFetchError(result))
      .map((player) => ({
        tag: player.tag,
        name: player.name,
        expLevel: player.expLevel,
      }))
      .sort((a, b) => b.expLevel - a.expLevel);

    return {
      discordId,
      players,
      userIndex,
      totalUsers: session.multipleAccountUserIds.length,
    };
  }

  /**
   * Save user's account selection
   */
  saveAccountSelection(sessionId: string, selection: AccountSelection): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // Store the selection in session.selections Map
    session.selections.set(selection.discordId, selection);
    console.log(`[saveAccountSelection] Saved selection for ${selection.discordId}, type: ${selection.type}`);

    // Move to next user (currentUserIndex++)
    session.currentUserIndex++;
    console.log(
      `[saveAccountSelection] Moved to user index ${session.currentUserIndex} of ${session.multipleAccountUserIds.length}`,
    );

    // If all users done, change step to 'confirmation'
    if (session.currentUserIndex >= session.multipleAccountUserIds.length) {
      session.step = 'confirmation';
      console.log(`[saveAccountSelection] All users processed, moving to confirmation step`);
    }

    // Update last activity
    session.lastActivity = new Date();

    return true;
  }

  // ============================================================================
  // STEP 10: Final confirmation
  // ============================================================================

  /**
   * Build final data for confirmation embed
   */
  async getFinalConfirmationData(sessionId: string): Promise<FinalChannelData | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    console.log('[getFinalConfirmationData] Session:', {
      finalAccounts: Array.from(session.categorized.finalAccounts.entries()),
      singleAccountUsers: Array.from(session.categorized.singleAccountUsers.entries()),
      selections: Array.from(session.selections.entries()),
    });

    // Combine all accounts:
    // 1. finalAccounts (from playertag input)
    // 2. singleAccountUsers (auto-selected)
    // 3. Accounts from selections (user chose for multiple account users)
    const allPlayertags = new Map<string, string[]>();

    // Add finalAccounts
    session.categorized.finalAccounts.forEach((playertags, discordId) => {
      if (!allPlayertags.has(discordId)) {
        allPlayertags.set(discordId, []);
      }
      allPlayertags.get(discordId)!.push(...playertags);
    });

    // Add singleAccountUsers
    session.categorized.singleAccountUsers.forEach((playertag, discordId) => {
      if (!allPlayertags.has(discordId)) {
        allPlayertags.set(discordId, []);
      }
      allPlayertags.get(discordId)!.push(playertag);
    });

    // Add selections from multiple account users
    session.selections.forEach((selection, discordId) => {
      if (selection.type === 'specific' && selection.selectedTags) {
        if (!allPlayertags.has(discordId)) {
          allPlayertags.set(discordId, []);
        }
        allPlayertags.get(discordId)!.push(...selection.selectedTags);
      }
      // For 'any' and 'skip' types, don't add playertags here
      // We'll handle 'any' type during channel creation
    });

    console.log('[getFinalConfirmationData] Combined playertags:', Array.from(allPlayertags.entries()));

    // Fetch player names for all playertags
    const accounts = new Map<string, PlayerInfo[] | { type: 'any'; count: number }>();

    for (const [discordId, playertags] of allPlayertags.entries()) {
      const playerResults = await Promise.all(playertags.map((tag) => CR_API.getPlayer(tag)));

      const players = playerResults
        .filter((result): result is Player => !isFetchError(result))
        .map((player) => ({
          tag: player.tag,
          name: player.name,
        }));

      if (players.length > 0) {
        accounts.set(discordId, players);
      }
    }

    // Add 'any' type selections as placeholders
    session.selections.forEach((selection, discordId) => {
      if (selection.type === 'any' && selection.accountCount) {
        accounts.set(discordId, { type: 'any', count: selection.accountCount });
      }
    });

    console.log('[getFinalConfirmationData] Final accounts with names:', Array.from(accounts.entries()));

    // Get clan info - either from matching channel name or from existing channel (for add mode)
    let clanInfo: ClanInfo | undefined;

    if (session.mode === 'add_member' && session.targetChannelId) {
      // Fetch clan info from existing channel
      const existingChannelRes = await pool.query(
        `SELECT clantag_focus, clan_name_focus FROM member_channels WHERE guild_id = $1 AND channel_id = $2`,
        [session.guildId, session.targetChannelId],
      );

      if (existingChannelRes.rows.length > 0 && existingChannelRes.rows[0].clantag_focus) {
        clanInfo = {
          clantag: existingChannelRes.rows[0].clantag_focus,
          clanName: existingChannelRes.rows[0].clan_name_focus,
          abbreviation: '', // Not needed for display
        };
      }
    } else {
      // For channel creation, try to match clan from channel name
      clanInfo = await this.findMatchingClan(session.guildId, session.input.channelName);
    }

    console.log(`find matching clan: ${clanInfo}`);
    return {
      channelName: session.input.channelName,
      accounts,
      clanInfo,
    };
  }

  /**
   * Create the actual Discord channel
   */
  async createChannel(sessionId: string, guild: Guild): Promise<{ success: boolean; error?: string; channelId?: string }> {
    console.log('Should be creating channel with:', sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    try {
      // Get final data
      const finalData = await this.getFinalConfirmationData(sessionId);
      if (!finalData) return { success: false, error: 'Failed to get final confirmation data' };

      // Get parent category from settings
      const parentIdResult = await pool.query(`SELECT category_id FROM member_channel_settings WHERE guild_id = $1`, [
        session.guildId,
      ]);
      const parentId = parentIdResult.rows[0]?.category_id;
      if (!parentId) {
        return { success: false, error: 'Parent category not configured' };
      }

      // Get Discord IDs from all accounts (including 'any' types)
      const discordIds = Array.from(finalData.accounts.keys());
      console.log('Discord IDs for permission overwrites:', discordIds);

      // Build permission overwrites (inherits category permissions + adds user permissions)
      const permissionOverwrites = await buildPermissionOverwrites(guild, parentId, discordIds);

      // Create Discord channel
      const channel = await guild.channels.create({
        name: session.input.channelName,
        type: ChannelType.GuildText,
        parent: parentId,
        permissionOverwrites,
      });

      console.log(`✅ Channel created: ${channel.name} (${channel.id})`);

      // Convert accounts to MemberData format for database (keeping 'any' types as-is)
      const { members } = convertToMemberData(finalData.accounts);

      // Store in database
      await insertMemberChannel(
        guild.id,
        parentId,
        channel.id,
        session.creatorId,
        session.input.channelName,
        finalData.clanInfo?.clantag ?? null,
        finalData.clanInfo?.clanName ?? null,
        members,
      );

      this.sessions.delete(sessionId);
      return { success: true, channelId: channel.id };
    } catch (error) {
      console.error('Error creating channel:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // ============================================================================
  // Utility methods
  // ============================================================================

  private async findMatchingClan(guildId: string, channelName: string): Promise<ClanInfo | undefined> {
    const findClanRes = await pool.query('SELECT clan_name, clantag, abbreviation FROM clans WHERE guild_id = $1', [
      guildId,
    ]);
    const clans: { clan_name: string; clantag: string; abbreviation: string }[] = findClanRes.rows;

    console.log('[findMatchingClan] Channel name:', channelName);
    console.log('[findMatchingClan] Clans found:', clans);

    const matchingClan = clans.find(
      (clan) =>
        channelName.toLowerCase().includes(clan.clan_name.toLowerCase()) ||
        channelName.toLowerCase().includes(clan.abbreviation.toLowerCase()),
    );

    console.log('[findMatchingClan] Matching clan:', matchingClan);

    if (matchingClan) {
      return {
        clanName: matchingClan.clan_name,
        clantag: matchingClan.clantag,
        abbreviation: matchingClan.abbreviation,
      };
    }
    return undefined;
  }

  /**
   * Start adding members to an existing channel
   * Similar to startChannelCreation but for adding to existing channel
   */
  async startAddingMembers(
    guildId: string,
    channelId: string,
    creatorId: string,
    input: { playertags: string; discordIds: string },
  ): Promise<string> {
    const sessionId = `${guildId}_${creatorId}_${Date.now()}_add`;

    // Parse playertags and discord ids (reuse existing logic)
    const parsed = this.parseInput({
      channelName: '', // Not needed for adding members
      playertags: input.playertags,
      discordIds: input.discordIds,
    });

    // Lookup database for linked accounts
    const dbResults = await this.lookupDatabase(guildId, parsed);

    // Categorize accounts
    const categorized = this.categorizeAccounts(dbResults, parsed);

    // Create session with 'add_member' mode
    const session: MemberChannelSession = {
      id: sessionId,
      guildId,
      creatorId,
      step: 'account_selection',
      input: parsed,
      invalidPlayertags: dbResults.invalidPlayertags,
      invalidDiscordIds: dbResults.invalidDiscordIds,
      categorized,
      selections: new Map(),
      multipleAccountUserIds: Array.from(categorized.multipleAccountUsers.keys()),
      currentUserIndex: 0,
      mode: 'add_member',
      targetChannelId: channelId,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  /**
   * Add members to an existing channel (called after confirmation)
   */
  async addMembersToChannel(
    sessionId: string,
    guild: Guild,
    channelId: string,
  ): Promise<{ success: boolean; error?: string; addedCount?: number }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    try {
      // Update database - fetch existing members first
      const existingRes = await pool.query(
        `SELECT members FROM member_channels WHERE guild_id = $1 AND channel_id = $2`,
        [session.guildId, channelId],
      );

      const existingMembers = existingRes.rows[0].members as import('../../utils/memberChannelHelpers.js').MemberData[];
      const existingDiscordIds = new Set(existingMembers.map((m) => m.discordId));

      // Get final data
      const finalData = await this.getFinalConfirmationData(sessionId);
      if (!finalData) return { success: false, error: 'Failed to get final confirmation data' };

      // Get Discord IDs that need permissions (only truly new users)
      const allDiscordIds = Array.from(finalData.accounts.keys());
      const newDiscordIds = allDiscordIds.filter((id) => !existingDiscordIds.has(id));

      // Update channel permissions only for new Discord IDs
      const channel = await guild.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        return { success: false, error: 'Channel not found' };
      }

      for (const discordId of newDiscordIds) {
        try {
          // Verify user exists in guild before setting permissions
          const member = await guild.members.fetch(discordId);
          if (member) {
            await channel.permissionOverwrites.edit(discordId, {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
            });
          }
        } catch (error) {
          console.warn(`[addMembersToChannel] Could not set permissions for user ${discordId}:`, error);
          // Continue with other members
        }
      }

      // Process members for database update
      const { members: newMembers } = convertToMemberData(finalData.accounts);

      // Merge members - for existing Discord IDs, merge their accounts; for new IDs, add them
      const mergedMembersMap = new Map<string, import('../../utils/memberChannelHelpers.js').MemberData>();

      // Add existing members to map
      existingMembers.forEach((member) => {
        mergedMembersMap.set(member.discordId, member);
      });

      // Process new members
      let addedCount = 0;
      for (const newMember of newMembers) {
        const existing = mergedMembersMap.get(newMember.discordId);

        if (!existing) {
          // New user - add them
          mergedMembersMap.set(newMember.discordId, newMember);
          addedCount++;
        } else {
          // Existing user - merge accounts
          if (Array.isArray(existing.players) && Array.isArray(newMember.players)) {
            // Both have specific accounts - merge and deduplicate by tag
            const existingTags = new Set(existing.players.map((p) => p.tag));
            const newAccounts = newMember.players.filter((p) => !existingTags.has(p.tag));

            if (newAccounts.length > 0) {
              existing.players = [...existing.players, ...newAccounts];
              addedCount++;
            }
          } else if (newMember.players && typeof newMember.players === 'object' && 'type' in newMember.players) {
            // New member has 'any' type - replace existing (or handle as needed)
            mergedMembersMap.set(newMember.discordId, newMember);
            addedCount++;
          }
        }
      }

      const allMembers = Array.from(mergedMembersMap.values());

      await pool.query(`UPDATE member_channels SET members = $1 WHERE guild_id = $2 AND channel_id = $3`, [
        JSON.stringify(allMembers),
        session.guildId,
        channelId,
      ]);

      this.sessions.delete(sessionId);
      return { success: true, addedCount };
    } catch (error) {
      console.error('Error adding members:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  getSession(sessionId: string): MemberChannelSession | null {
    return this.sessions.get(sessionId) || null;
  }

  cleanupExpiredSessions(): void {
    const expiryTime = new Date(Date.now() - SESSION_EXPIRY_MINUTES * 60 * 1000);
    for (const [id, session] of this.sessions) {
      if (session.lastActivity < expiryTime) {
        this.sessions.delete(id);
      }
    }
  }
}

export const memberChannelService = new MemberChannelService();

// Cleanup expired sessions periodically
setInterval(() => memberChannelService.cleanupExpiredSessions(), SESSION_CLEANUP_INTERVAL_MINUTES * 60 * 1000);
