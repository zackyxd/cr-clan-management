import type { Player } from '../../api/CR_API.js';

/**
 * Step 2: Initial modal input from user
 */
export interface ChannelCreationInput {
  channelName: string;
  playertags: string; // raw input string
  discordIds: string; // raw input string
}

/**
 * Step 4: Parsed and validated input
 */
export interface ParsedChannelInput {
  channelName: string;
  playertagArray: string[]; // cleaned, normalized tags
  discordIdArray: string[]; // cleaned ids
}

export interface ClanInfo {
  clanName: string;
  clantag: string;
  abbreviation: string;
}

/**
 * Step 6: Database results
 */
export interface DatabaseLookupResult {
  // For each playertag inputted, which discord id owns it
  playertagToDiscordId: Map<string, string>; // playertag -> discord_id

  // For each discord id inputted, what playertags do they have
  discordIdToPlayertags: Map<string, string[]>; // discord_id -> playertag[]

  // Invalid entries that didn't return database results
  invalidPlayertags: string[]; // playertags that aren't linked to anyone in this guild
  invalidDiscordIds: string[]; // discord_ids that have no linked playertags in this guild
}

/**
 * Step 7-8: Categorized accounts
 */
export interface CategorizedAccounts {
  // Accounts that are final (from playertag input)
  finalAccounts: Map<string, string[]>; // discord_id -> playertag[]

  // Discord IDs with only 1 account (auto-selected)
  singleAccountUsers: Map<string, string>; // discord_id -> playertag

  // Discord IDs with multiple accounts (need selection)
  multipleAccountUsers: Map<string, string[]>; // discord_id -> playertag[]
}

/**
 * Step 9: User's selection for multiple accounts
 */
export interface AccountSelection {
  type: 'specific' | 'any' | 'skip';
  discordId: string;

  // For 'specific' type
  selectedTags?: string[];

  // For 'any' type
  accountCount?: number;
}

/**
 * Step 10: Final data for confirmation
 */
export interface FinalChannelData {
  channelName: string;
  accounts: Map<string, PlayerInfo[] | { type: 'any'; count: number }>; // discord_id -> player info or 'any X accounts'
  clanInfo?: {
    clantag: string;
    clanName: string;
  };
}

/**
 * Player information with name
 */
export interface PlayerInfo {
  tag: string;
  name: string;
}

/**
 * Session data stored during multi-step flow
 */
export interface MemberChannelSession {
  id: string;
  guildId: string;
  creatorId: string;

  // Current step in the process
  step: 'account_selection' | 'confirmation';

  // Data accumulated through the flow
  input: ParsedChannelInput;
  invalidPlayertags: string[];
  invalidDiscordIds: string[];
  categorized: CategorizedAccounts;
  selections: Map<string, AccountSelection>; // discord_id -> selection

  // For pagination through multiple account users
  multipleAccountUserIds: string[];
  currentUserIndex: number;

  // Mode: 'create' for new channel, 'add_member' for adding to existing
  mode?: 'create' | 'add_member';
  targetChannelId?: string; // Only used in 'add_member' mode

  createdAt: Date;
  lastActivity: Date;
}
