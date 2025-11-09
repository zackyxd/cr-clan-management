import { pool } from '../db.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { EmbedColor, BOTCOLOR } from '../types/EmbedUtil.js';
import { makeCustomId } from '../utils/customId.js';

// Define all possible setting types in one place
export type SettingType = 'toggle' | 'modal' | 'swap' | 'channel' | 'number' | 'role' | 'text' | 'action';

// Define the structure of a feature setting
export interface FeatureSetting {
  key: string;
  label: string;
  description: string;
  type: SettingType;
  defaultValue?: boolean | string | number; // Default value for the setting
}

// Define the structure of a feature
export interface Feature {
  name: string; // Internal name used in code and DB
  displayName: string; // Formatted name for display
  description: string;
  tableName: string; // Database table name
  defaultEnabled: boolean; // Whether the feature is enabled by default
  settings: FeatureSetting[];
}

// Central registry of all features
export const FeatureRegistry: Record<string, Feature> = {
  links: {
    name: 'links',
    displayName: 'Links',
    description:
      'Links feature handles everything related to linking Discord accounts to their Clash Royale playertags.',
    tableName: 'link_settings',
    defaultEnabled: true,
    settings: [
      {
        key: 'rename_players',
        label: 'Auto Rename',
        description: 'Automatically rename linked users to match their in-game name.',
        type: 'toggle',
        defaultValue: false,
      },
      {
        key: 'max_player_links',
        label: 'Max Links',
        description: 'Max amount of playertags linked to each @user',
        type: 'number',
        defaultValue: 10,
      },
    ],
  },
  tickets: {
    name: 'tickets',
    displayName: 'Tickets',
    description: 'Ticket features handles everything related to tickets and ensuring you can handle new members.',
    tableName: 'ticket_settings',
    defaultEnabled: false,
    settings: [
      {
        key: 'opened_identifier',
        label: 'Ticket Created Text',
        description: 'The text that will appear in created channels used for tickets.',
        type: 'modal',
        defaultValue: 'ticket',
      },
      {
        key: 'closed_identifier',
        label: 'Ticket Closed Text',
        description: 'The text that will appear in closed channels used for tickets.',
        type: 'modal',
        defaultValue: 'closed',
      },
      {
        key: 'allow_append',
        label: 'Append to ticket',
        description:
          'Allow the bot to append text to the channel name. Coleaders+ can use `/append` inside of the channel to add to it.',
        type: 'toggle',
        defaultValue: false,
      },
      {
        key: 'send_logs',
        label: 'Send Logs',
        description: 'Allow the bot to send log information about tickets.',
        type: 'toggle',
        defaultValue: false,
      },
      {
        key: 'logs_channel_id',
        label: 'Logs Channel',
        description: 'Which channel do you want to send logs to?',
        type: 'channel',
        defaultValue: '',
      },
    ],
  },
  clan_invites: {
    name: 'clan_invites',
    displayName: 'Clan Invites',
    description: 'Clan invite settings manage how invites are handled and displayed.',
    tableName: 'clan_invite_settings',
    defaultEnabled: true,
    settings: [
      {
        key: 'pin_message',
        label: 'Pin Message',
        description: 'Keep the clan invites message pinned.',
        type: 'toggle',
        defaultValue: false,
      },
      {
        key: 'delete_method',
        label: 'Expiry method',
        description: 'Switch how expire generated links are handled. Delete the messages or edit them.',
        type: 'swap',
        defaultValue: 'update',
      },
      {
        key: 'show_inactive',
        label: 'Inactive Links',
        description: 'Show the inactive links on the clan invites message.',
        type: 'toggle',
        defaultValue: false,
      },
      {
        key: 'ping_expired',
        label: 'Ping Expired',
        description: 'Ping the clan role in the clan invites channel to notify that a new link is needed.',
        type: 'toggle',
        defaultValue: false,
      },
      {
        key: 'send_logs',
        label: 'Send Logs',
        description: 'Allow the bot to send log information about clan invites.',
        type: 'toggle',
        defaultValue: false,
      },
      {
        key: 'logs_channel_id',
        label: 'Logs Channel',
        description: 'Which channel do you want to send logs to?',
        type: 'channel',
        defaultValue: '',
      },
    ],
  },
  member_channels: {
    name: 'member_channels',
    displayName: 'Member Channels',
    description: 'Member channels feature handles everything related to member channels.',
    tableName: 'member_channel_settings',
    defaultEnabled: false,
    settings: [
      {
        key: 'pin_invite',
        label: 'Pin Invite',
        description: 'Pin the invite message in the member channel. Refresh when invite is regenerated.',
        type: 'toggle',
        defaultValue: false,
      },
      {
        key: 'auto_ping',
        label: 'Auto Ping',
        description: 'Automatically ping members every 12 hours since the last ping (on training days).',
        type: 'toggle',
        defaultValue: false,
      },
      {
        key: 'logs_channel_id',
        label: 'Logs Channel',
        description: 'Which channel do you want to send logs to?',
        type: 'channel',
        defaultValue: '',
      },
    ],
  },
};

// Helper functions for working with the registry

/**
 * Get all feature names
 */
export function getAllFeatureNames(): string[] {
  return Object.keys(FeatureRegistry);
}

/**
 * Get all features as an object with default enabled values
 */
export function getDefaultFeaturesState(): Record<string, boolean> {
  return Object.entries(FeatureRegistry).reduce((acc, [name, feature]) => {
    acc[name] = feature.defaultEnabled;
    return acc;
  }, {} as Record<string, boolean>);
}

/**
 * Get feature settings with default values
 */
export function getFeatureDefaultSettings(featureName: string): Record<string, boolean | string | number> {
  const feature = FeatureRegistry[featureName];
  if (!feature) return {};

  return feature.settings.reduce((acc, setting) => {
    if (setting.defaultValue !== undefined) {
      acc[setting.key] = setting.defaultValue;
    }
    return acc;
  }, {} as Record<string, boolean | string | number>);
}

/**
 * Get all features settings tables and defaults for initialization
 */
export function getFeatureSettingsDefaults(): Record<
  string,
  { table: string; defaults: Record<string, boolean | string | number> }
> {
  return Object.entries(FeatureRegistry).reduce((acc, [name, feature]) => {
    acc[name] = {
      table: feature.tableName,
      defaults: getFeatureDefaultSettings(name),
    };
    return acc;
  }, {} as Record<string, { table: string; defaults: Record<string, boolean | string | number> }>);
}

/**
 * Check if a feature is enabled for a guild
 */
export async function isFeatureEnabled(guildId: string, featureName: string): Promise<boolean> {
  const result = await pool.query(`SELECT is_enabled FROM guild_features WHERE guild_id = $1 AND feature_name = $2`, [
    guildId,
    featureName,
  ]);
  return result.rows[0]?.is_enabled ?? false;
}

/**
 * Check if a feature setting is enabled for a guild
 */
export async function checkFeatureSetting(
  guildId: string,
  featureName: string,
  settingKey: string
): Promise<{ enabled: boolean; embed?: EmbedBuilder }> {
  const feature = FeatureRegistry[featureName];
  if (!feature) {
    return { enabled: false };
  }

  const result = await pool.query(`SELECT ${settingKey} FROM ${feature.tableName} WHERE guild_id = $1`, [guildId]);

  const value = result.rows[0]?.[settingKey] ?? false;

  if (!value) {
    const embed = new EmbedBuilder()
      .setDescription(
        `**The \`${settingKey}\` feature for ${feature.displayName} has not been enabled for this guild.**\nPlease ask one of the server admins to enable it in \`/server-settings\``
      )
      .setColor(EmbedColor.FAIL);
    return { enabled: false, embed: embed };
  }

  return { enabled: true };
}

/**
 * Generate the SQL for inserting default features for a list of guild IDs
 */
export function generateInsertDefaultFeaturesSQL(guildIds: string[]): { query: string; params: (string | boolean)[] } {
  const defaultFeatures = getDefaultFeaturesState();
  const values: (string | boolean)[] = [];
  const placeholders: string[] = [];
  let paramIndex = 1;

  guildIds.forEach((guildId) => {
    Object.entries(defaultFeatures).forEach(([featureName, isEnabled]) => {
      values.push(guildId, featureName, isEnabled);
      placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`);
      paramIndex += 3;
    });
  });

  const query = `
    INSERT INTO guild_features (guild_id, feature_name, is_enabled)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (guild_id, feature_name) DO NOTHING;
  `;

  return { query, params: values };
}
