// Cache for member channel creation workflow
// Stores data needed across multiple interactions during channel creation

export interface PlayerInfo {
  tag: string;
  name: string;
}

export interface MemberChannelData {
  channelName: string;
  clantagFocus: string | null;
  clanNameFocus: string | null;
  singleAccountUsers: Map<string, string>; // discordId -> playertag
  multipleAccountUsers: Map<string, string[]>; // discordId -> playertags[]
  selectedAccounts: Map<string, string[]>; // discordId -> selected playertags
  currentUserIndex: number; // Which user we're asking to select accounts for
  multipleAccountUserIds: string[]; // Array of discord IDs with multiple accounts
  guildId: string;
  creatorId: string; // The person creating the channel
  finalAccountSelection?: Map<string, PlayerInfo[]>; // Final combined accounts: discordId -> PlayerInfo[]
}

export const memberChannelCache = new Map<string, MemberChannelData>();

// Cleanup cache after 10 minutes
export function cleanupMemberChannelCache(interactionId: string) {
  setTimeout(() => {
    memberChannelCache.delete(interactionId);
  }, 10 * 60 * 1000);
}
