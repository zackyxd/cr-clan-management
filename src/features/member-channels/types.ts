/**
 * Member Channel Feature Types
 * All types specific to member channel functionality
 */

import type { Player } from '../../api/CR_API.js';

export interface PlayerInfo {
  tag: string;
  name: string;
}

export interface AccountSelectionContext {
  userId: string;
  guildId: string;
  players: Player[];
  maxAccounts?: number;
  // Legacy fields for backwards compatibility
  discordId?: string;
  availableAccounts?: string[];
  userIndex?: number;
  totalUsers?: number;
}

export interface MemberChannelConfig {
  selectedPlayers: Player[];
  accountCount?: number;
  guildId: string;
  userId: string;
}

export interface MemberChannelSession {
  id: string;
  config: MemberChannelConfig;
  step: 'account_selection' | 'confirmation' | 'creation';
  createdAt: Date;
  lastActivity: Date;
  // Extended data for complex account selection workflow
  accountData?: {
    finalSingleAccountUsers: Map<string, string>;
    finalMultipleAccountUsers: Map<string, string[]>;
    preSelectedAccounts: Map<string, string[]>;
    channelName: string;
    currentUserIndex: number;
  };
}

export interface MemberChannelData {
  channelName: string;
  clantagFocus: string | null;
  clanNameFocus: string | null;
  singleAccountUsers: Map<string, string>; // discordId -> playertag
  multipleAccountUsers: Map<string, string[]>; // discordId -> playertags[]
  selectedAccounts: Map<string, string[]>; // discordId -> selected playertags (when specific accounts chosen)
  anyAccountCounts: Map<string, number>; // discordId -> number of accounts to use (when "any X accounts" chosen)
  currentUserIndex: number; // Which user we're asking to select accounts for
  multipleAccountUserIds: string[]; // Array of discord IDs with multiple accounts
  guildId: string;
  creatorId: string; // The person creating the channel
  finalAccountSelection?: Map<string, PlayerInfo[]>; // Final combined accounts: discordId -> PlayerInfo[]
}

export interface MemberChannelCreateInput {
  channelName: string;
  playertags: string;
  discordIds: string;
  guildId: string;
  creatorId: string;
}

// Legacy context interface for backwards compatibility
export interface LegacyAccountSelectionContext {
  discordId: string;
  availableAccounts: string[];
  userIndex: number;
  totalUsers: number;
}

export interface ValidationResult<T = unknown> {
  isValid: boolean;
  error?: string;
  data?: T;
}

// Re-export commonly used Discord types for convenience
export type {
  CommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
} from 'discord.js';
