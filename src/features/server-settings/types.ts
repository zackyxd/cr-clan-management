import type { Client } from 'discord.js';

/**
 * Response structure for server settings operations
 */
export interface ServerSettingsResponse {
  success: boolean;
  error?: string;
  newValue?: boolean | string;
  requiresInviteUpdate?: boolean;
  inviteData?: {
    channelId: string;
    messageId: string;
    pinMessage: boolean;
  };
}

/**
 * Parameters for updating a channel setting
 */
export interface UpdateChannelSettingParams {
  guildId: string;
  settingKey: string;
  tableName: string;
  channelId: string;
  channelType?: 'text' | 'category';
}

/**
 * Parameters for updating a text setting
 */
export interface UpdateTextSettingParams {
  guildId: string;
  settingKey: string;
  tableName: string;
  value: string;
}

/**
 * Parameters for toggling a setting
 */
export interface ToggleSettingParams {
  guildId: string;
  settingKey: string;
  tableName: string;
  client?: Client;
}

/**
 * Parameters for swapping a setting value
 */
export interface SwapSettingParams {
  guildId: string;
  settingKey: string;
  tableName: string;
}
