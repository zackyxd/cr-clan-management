/**
 * Clan Settings Feature Types
 * All types specific to clan settings functionality
 */

export interface ClanSettingsData {
  settingKey: string;
  clantag: string;
  clanName: string;
  guildId: string;
  ownerId: string;
}

export interface ClanSettings {
  family_clan: boolean;
  nudge_enabled: boolean;
  invites_enabled: boolean;
  clan_role_id?: string;
  abbreviation?: string;
  // Add other settings as needed
}

export interface ClanSettingsResponse {
  success: boolean;
  settings?: ClanSettings;
  error?: string;
}

export interface ClanInviteSettings {
  channel_id: string;
  message_id: string;
  pin_message: boolean;
  invites_enabled: boolean;
}

// Re-export Discord types for convenience
export type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  EmbedBuilder,
  ActionRowBuilder,
} from 'discord.js';
