import type { Player, PlayerResult, FetchError } from '../../api/CR_API.js';
import { CR_API, isFetchError } from '../../api/CR_API.js';
import { buildGetLinkedDiscordIds, buildGetLinkedPlayertags } from '../../sql_queries/users.js';
import { pool } from '../../db.js';
import type { MemberChannelConfig, MemberChannelSession, AccountSelectionContext, PlayerInfo } from './types.js';

/**
 * Core service class for managing member channel functionality
 * Handles the complete lifecycle of member channel creation
 */
export class MemberChannelService {
  private sessions = new Map<string, MemberChannelSession>();

  /**
   * Start a new member channel creation session
   */
  async startChannelCreation(guildId: string, userId: string, config: Partial<MemberChannelConfig>): Promise<string> {
    const sessionId = `${guildId}_${userId}_${Date.now()}`;

    const session: MemberChannelSession = {
      id: sessionId,
      config: {
        selectedPlayers: [],
        guildId,
        userId,
        ...config,
      },
      step: 'account_selection',
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  /**
   * Get an active session
   */
  getSession(sessionId: string): MemberChannelSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Update last activity
    session.lastActivity = new Date();
    return session;
  }

  /**
   * Update session configuration
   */
  updateSession(sessionId: string, updates: Partial<MemberChannelConfig>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.config = { ...session.config, ...updates };
    session.lastActivity = new Date();
    return true;
  }

  /**
   * Move session to next step
   */
  advanceSession(sessionId: string, step: MemberChannelSession['step']): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.step = step;
    session.lastActivity = new Date();
    return true;
  }

  /**
   * Clean up expired sessions (older than 30 minutes)
   */
  cleanupExpiredSessions(): void {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    for (const [sessionId, session] of this.sessions) {
      if (session.lastActivity < thirtyMinutesAgo) {
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * End a session (successful completion or cancellation)
   */
  endSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Get account selection context for a user
   */
  createAccountSelectionContext(userId: string, guildId: string, players: Player[]): AccountSelectionContext {
    return {
      userId,
      guildId,
      players,
      maxAccounts: Math.min(players.length, 10), // Discord select menu limit
    };
  }

  /**
   * Process account count selection (when user chooses "any X accounts")
   */
  async processAccountCountSelection(sessionId: string, accountCount: number, players: Player[]): Promise<boolean> {
    const session = this.getSession(sessionId);
    if (!session) return false;

    // Select the top N players by trophies
    const selectedPlayers = players
      .sort((a, b) => (b.trophies as number) - (a.trophies as number))
      .slice(0, accountCount);

    return this.updateSession(sessionId, {
      selectedPlayers,
      accountCount,
    });
  }

  /**
   * Process specific account selection (when user chooses specific accounts)
   */
  async processSpecificAccountSelection(
    sessionId: string,
    selectedPlayerTags: string[],
    allPlayers: Player[]
  ): Promise<boolean> {
    const session = this.getSession(sessionId);
    if (!session) return false;

    const selectedPlayers = allPlayers.filter((p) => selectedPlayerTags.includes(p.tag));

    return this.updateSession(sessionId, {
      selectedPlayers,
    });
  }

  /**
   * Get session statistics
   */
  getStats(): {
    activeSessions: number;
    sessionsByStep: Record<string, number>;
  } {
    const stats = {
      activeSessions: this.sessions.size,
      sessionsByStep: {} as Record<string, number>,
    };

    for (const session of this.sessions.values()) {
      stats.sessionsByStep[session.step] = (stats.sessionsByStep[session.step] || 0) + 1;
    }

    return stats;
  }

  /**
   * Main business logic for processing channel creation request
   * This replicates the logic from your original memberChannelCreate.delete.later.ts
   */
  async processChannelCreationRequest(request: {
    channelName: string;
    playertags: string[];
    discordIds: string[];
    guildId: string;
    creatorId: string;
  }) {
    // 1. Validate input
    if (!request.channelName || request.channelName.length > 25) {
      throw new Error('Invalid channel name');
    }

    // 2. Parse and clean input arrays
    const playertagArray = this.parsePlayertags(request.playertags.join(' '));
    const discordIdArray = this.parseDiscordIds(request.discordIds.join(' '));

    // 3. Fetch valid players for the playertags
    const validPlayers = await this.fetchValidPlayers(playertagArray);
    const validPlayertags = validPlayers.map((player) => player.tag);

    // 4. Get linked account data from database
    const resTags = await this.getDiscordIdsFromPlayertags(request.guildId, validPlayertags);
    const resIds = await this.getPlayertagsFromDiscordIds(request.guildId, discordIdArray);

    // 5. Separate accounts from playertags (explicitly chosen) vs Discord IDs (need selection)
    const accountsFromPlayertags = new Map<string, string[]>();
    resTags.forEach(({ discord_id, playertag }) => {
      if (!accountsFromPlayertags.has(discord_id)) {
        accountsFromPlayertags.set(discord_id, []);
      }
      accountsFromPlayertags.get(discord_id)!.push(playertag);
    });

    // Accounts from Discord ID input (might need selection if 2+ accounts)
    const accountsFromDiscordIds = new Map<string, string[]>();
    resIds.forEach(({ discord_id, playertag }) => {
      if (!accountsFromDiscordIds.has(discord_id)) {
        accountsFromDiscordIds.set(discord_id, []);
      }
      accountsFromDiscordIds.get(discord_id)!.push(playertag);
    });

    // 6. Build final single/multiple account users
    const finalSingleAccountUsers = new Map<string, string>();
    const finalMultipleAccountUsers = new Map<string, string[]>();
    const preSelectedAccounts = new Map<string, string[]>();

    // Process playertag accounts (all are pre-selected, no selection needed)
    accountsFromPlayertags.forEach((playertags, discordId) => {
      const uniqueTags = [...new Set(playertags)];
      if (uniqueTags.length === 1) {
        finalSingleAccountUsers.set(discordId, uniqueTags[0]);
      } else {
        finalSingleAccountUsers.set(discordId, uniqueTags[0]); // Representative
        preSelectedAccounts.set(discordId, uniqueTags); // All of them
      }
    });

    // Process Discord ID accounts (only ask for selection if 2+ accounts)
    accountsFromDiscordIds.forEach((playertags, discordId) => {
      const uniqueTags = [...new Set(playertags)];

      // Check if this Discord ID was already handled by playertag input
      if (accountsFromPlayertags.has(discordId)) {
        const explicitlySelectedTags = accountsFromPlayertags.get(discordId)!;
        const allTagsForUser = [...new Set([...explicitlySelectedTags, ...uniqueTags])];

        if (allTagsForUser.length === 1) {
          finalSingleAccountUsers.set(discordId, allTagsForUser[0]);
        } else if (allTagsForUser.length >= 2) {
          finalSingleAccountUsers.delete(discordId);
          finalMultipleAccountUsers.set(discordId, allTagsForUser);
          preSelectedAccounts.set(discordId, explicitlySelectedTags);
        }
        return;
      }

      if (uniqueTags.length === 1) {
        finalSingleAccountUsers.set(discordId, uniqueTags[0]);
      } else if (uniqueTags.length >= 2) {
        finalMultipleAccountUsers.set(discordId, uniqueTags);
      }
    });

    // 7. Check if we found any linked accounts
    const totalLinkedAccounts = finalSingleAccountUsers.size + finalMultipleAccountUsers.size;
    if (totalLinkedAccounts === 0) {
      throw new Error('No linked accounts found for the provided playertags/Discord IDs');
    }

    // 8. Start session with processed data
    const sessionId = await this.startChannelCreation(request.guildId, request.creatorId, {
      selectedPlayers: [],
      guildId: request.guildId,
      userId: request.creatorId,
    });

    // Store the processed account data in the service session
    this.updateSession(sessionId, {
      selectedPlayers: [], // Will be populated during account selection
    });

    // Store account selection data for later retrieval
    this.storeAccountSelectionData(sessionId, {
      finalSingleAccountUsers,
      finalMultipleAccountUsers,
      preSelectedAccounts,
      channelName: request.channelName,
    });

    return {
      sessionId,
      needsAccountSelection: finalMultipleAccountUsers.size > 0,
      finalSingleAccountUsers,
      finalMultipleAccountUsers,
      preSelectedAccounts,
      channelName: request.channelName,
      totalLinkedAccounts,
      // Add these for the router to use:
      multipleAccountUserIds: Array.from(finalMultipleAccountUsers.keys()),
    };
  }

  /**
   * Parse playertags input string into clean array
   * From your original parsePlayertags function
   */
  private parsePlayertags(input: string): string[] {
    const arr = Array.from(
      new Set(
        input
          .split(/[\s,]+/)
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0)
      )
    );
    return arr;
  }

  /**
   * Parse Discord IDs input string into clean array
   * From your original parseDiscordIds function
   */
  private parseDiscordIds(input: string): string[] {
    const arr = Array.from(
      new Set(
        input
          .split(/\s+/)
          .map((id) => {
            // Remove mention formatting: <@123>, <@!123>
            const match = id.match(/^<@!?(\d+)>$/);
            return match ? match[1] : id.trim();
          })
          .filter((id) => id.length > 0)
      )
    );
    return arr;
  }

  /**
   * Fetch valid players from Clash Royale API
   * From your original fetchValidPlayers function
   */
  private async fetchValidPlayers(playertags: string[]): Promise<Player[]> {
    const playerResults: (PlayerResult | FetchError)[] = await Promise.all(
      playertags.map((tag) => CR_API.getPlayer(tag))
    );
    return playerResults
      .filter((result): result is Player => !isFetchError(result))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get Discord IDs linked to specific playertags
   * From your original getDiscordIdsFromPlayertags function
   */
  private async getDiscordIdsFromPlayertags(
    guildId: string,
    playertags: string[]
  ): Promise<{ discord_id: string; playertag: string }[]> {
    if (playertags.length === 0) return [];
    const sql = buildGetLinkedDiscordIds(guildId, playertags);
    const res = await pool.query(sql);
    return res.rows; // [{ discord_id, playertag }]
  }

  /**
   * Get playertags linked to specific Discord IDs
   * From your original getPlayertagsFromDiscordIds function
   */
  private async getPlayertagsFromDiscordIds(
    guildId: string,
    discordIds: string[]
  ): Promise<{ discord_id: string; playertag: string }[]> {
    if (discordIds.length === 0) return [];
    const sql = buildGetLinkedPlayertags(guildId, discordIds);
    const res = await pool.query(sql);
    return res.rows; // [{ discord_id, playertag }]
  }

  /**
   * Group playertags by discord_id
   * From your original groupPlayertagsByDiscordId function
   */
  public groupPlayertagsByDiscordId(rows: { discord_id: string; playertag: string }[]) {
    const map = new Map<string, string[]>();
    rows.forEach(({ discord_id, playertag }) => {
      if (!map.has(discord_id)) map.set(discord_id, []);
      map.get(discord_id)!.push(playertag);
    });
    // Remove duplicates
    map.forEach((tags, discordId) => map.set(discordId, [...new Set(tags)]));
    return map;
  }

  /**
   * Get combined final accounts with player names
   * From your original getCombinedFinalAccountsWithNames function
   */
  public async getCombinedFinalAccountsWithNames(data: {
    singleAccountUsers: Map<string, string>;
    selectedAccounts: Map<string, string[]>;
  }): Promise<Map<string, PlayerInfo[]>> {
    const allFinalAccounts = new Map<string, PlayerInfo[]>();

    // Collect all playertags that need name lookup
    const allPlayertags = new Set<string>();

    // Add single account users playertags
    data.singleAccountUsers.forEach((playertag) => {
      allPlayertags.add(playertag);
    });

    // Add selected accounts playertags
    data.selectedAccounts.forEach((selectedPlayertags) => {
      selectedPlayertags.forEach((tag) => allPlayertags.add(tag));
    });

    // Fetch all player data at once for efficiency
    const playerResults: (PlayerResult | FetchError)[] = await Promise.all(
      Array.from(allPlayertags).map((tag) => CR_API.getPlayer(tag))
    );

    // Create a map of tag -> name for quick lookup and maintain order
    const tagToName = new Map<string, string>();
    const tagToPlayer = new Map<string, Player>();
    playerResults.forEach((result) => {
      if (!isFetchError(result)) {
        tagToName.set(result.tag, result.name);
        tagToPlayer.set(result.tag, result);
      }
    });

    // Add single account users (each has exactly one playertag)
    data.singleAccountUsers.forEach((playertag, discordId) => {
      const playerInfo = {
        tag: playertag,
        name: tagToName.get(playertag) || 'Unknown Player',
      };
      allFinalAccounts.set(discordId, [playerInfo]);
    });

    // Add selected accounts from multi-account users and sort by name
    data.selectedAccounts.forEach((selectedPlayertags, discordId) => {
      const playerInfos = selectedPlayertags
        .map((tag) => ({
          tag,
          name: tagToName.get(tag) || 'Unknown Player',
          player: tagToPlayer.get(tag),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)) // Sort by name
        .map(({ tag, name }) => ({ tag, name }));
      allFinalAccounts.set(discordId, playerInfos);
    });

    return allFinalAccounts;
  }

  /**
   * Create the actual Discord channel
   */
  async createDiscordChannel(
    sessionId: string,
    guildId?: string
  ): Promise<{ success: boolean; channelId?: string; error?: string }> {
    // Use guild validation if guildId provided (recommended)
    const session = guildId ? this.getSessionForGuild(sessionId, guildId) : this.getSession(sessionId);
    if (!session) {
      return { success: false, error: guildId ? 'Session not found or guild mismatch' : 'Session not found' };
    }

    try {
      // TODO: Implement actual Discord channel creation
      // const channel = await guild.channels.create({
      //   name: session.config.channelName,
      //   type: ChannelType.GuildText,
      //   // ... other settings
      // });

      console.log('Creating channel for session:', session);

      // Cleanup session after successful creation
      this.endSession(sessionId);

      return { success: true, channelId: 'placeholder-channel-id' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Prepare account selection data for a user with multiple accounts
   * Based on your original showAccountSelectionForUser function
   */
  async prepareAccountSelectionForUser(
    guildId: string,
    discordId: string,
    playertags: string[],
    userIndex: number,
    totalUsers: number,
    preSelectedTags: string[] = []
  ): Promise<{
    discordId: string;
    players: Player[];
    userIndex: number;
    totalUsers: number;
    preSelectedTags: string[];
  }> {
    // Validate that we're working with the correct guild context
    // This is important for security and data isolation
    if (!guildId) {
      throw new Error('Guild ID is required for account selection');
    }

    // Fetch player data for these playertags to show names
    const playerResults: (PlayerResult | FetchError)[] = await Promise.all(
      playertags.map((tag) => CR_API.getPlayer(tag))
    );

    const validPlayers = playerResults.filter((result): result is Player => !isFetchError(result));
    validPlayers.sort((a, b) => b.expLevel - a.expLevel);

    // Additional security: We could validate that the playertags are actually
    // linked to this Discord user in this specific guild here if needed

    return {
      discordId,
      players: validPlayers,
      userIndex,
      totalUsers,
      preSelectedTags,
    };
  }

  /**
   * Store complex account selection data in session
   */
  storeAccountSelectionData(
    sessionId: string,
    data: {
      finalSingleAccountUsers: Map<string, string>;
      finalMultipleAccountUsers: Map<string, string[]>;
      preSelectedAccounts: Map<string, string[]>;
      channelName: string;
    }
  ): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;

    // Store in session config (extend config as needed)
    session.accountData = {
      finalSingleAccountUsers: data.finalSingleAccountUsers,
      finalMultipleAccountUsers: data.finalMultipleAccountUsers,
      preSelectedAccounts: data.preSelectedAccounts,
      channelName: data.channelName,
      currentUserIndex: 0,
    };

    return true;
  }

  /**
   * Get account selection data from session
   */
  getAccountSelectionData(sessionId: string): {
    finalSingleAccountUsers: Map<string, string>;
    finalMultipleAccountUsers: Map<string, string[]>;
    preSelectedAccounts: Map<string, string[]>;
    channelName: string;
    currentUserIndex: number;
  } | null {
    const session = this.getSession(sessionId);
    if (!session || !session.accountData) return null;

    return session.accountData;
  }

  /**
   * Update which user we're currently processing for account selection
   */
  updateCurrentUserIndex(sessionId: string, userIndex: number): boolean {
    const session = this.getSession(sessionId);
    if (!session || !session.accountData) return false;

    session.accountData.currentUserIndex = userIndex;
    return true;
  }

  /**
   * Process user's account selection (either specific accounts or any count)
   */
  processUserAccountSelection(
    sessionId: string,
    discordId: string,
    selection: {
      type: 'specific' | 'any';
      accounts?: string[]; // for 'specific' type
      count?: number; // for 'any' type
    }
  ): boolean {
    const session = this.getSession(sessionId);
    const accountData = session?.accountData;
    if (!session || !accountData) return false;

    if (selection.type === 'specific' && selection.accounts) {
      // User selected specific accounts
      accountData.preSelectedAccounts.set(discordId, selection.accounts);
    } else if (selection.type === 'any' && selection.count) {
      // User wants any X accounts (store as special marker)
      const availableAccounts = accountData.finalMultipleAccountUsers.get(discordId) || [];
      const selectedAccounts = availableAccounts.slice(0, selection.count);
      accountData.preSelectedAccounts.set(discordId, selectedAccounts);
    }

    return true;
  }

  /**
   * Validate that a session belongs to a specific guild (security check)
   */
  validateSessionGuild(sessionId: string, guildId: string): boolean {
    const session = this.getSession(sessionId);
    if (!session) return false;

    return session.config.guildId === guildId;
  }

  /**
   * Get session with guild validation (recommended for all guild-specific operations)
   */
  getSessionForGuild(sessionId: string, guildId: string): MemberChannelSession | null {
    const session = this.getSession(sessionId);
    if (!session || session.config.guildId !== guildId) {
      return null;
    }
    return session;
  }
}

// Singleton instance
export const memberChannelService = new MemberChannelService();

// Cleanup expired sessions every 5 minutes
setInterval(() => {
  memberChannelService.cleanupExpiredSessions();
}, 5 * 60 * 1000);
