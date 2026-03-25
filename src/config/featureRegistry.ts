import { pool } from '../db.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { EmbedColor, BOTCOLOR } from '../types/EmbedUtil.js';
import { makeCustomId } from '../utils/customId.js';
import {
  MAX_CLANS_PER_GUILD,
  MAX_PLAYER_LINKS_PER_USER,
  DEFAULT_TICKET_OPENED_IDENTIFIER,
  DEFAULT_TICKET_CLOSED_IDENTIFIER,
  DEFAULT_DELETE_METHOD,
  MAX_FAMILY_CLANS_PER_GUILD,
} from './constants.js';

// Define all possible setting types in one place
export type SettingType = 'toggle' | 'modal' | 'swap' | 'channel' | 'number' | 'role' | 'text' | 'action' | 'info';

// Define the structure of a feature setting
export interface FeatureSetting {
  key: string;
  label: string;
  description: string;
  type: SettingType;
  defaultValue?: boolean | string | number; // Default value for the setting
  maxValue?: number; // For 'info' type: reference another setting's key to show "current/max" format
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
  global: {
    name: 'global',
    displayName: 'Global',
    description: 'Global settings that affect the entire bot functionality.',
    tableName: 'server_settings',
    defaultEnabled: true,
    settings: [
      {
        key: 'logs_channel_id',
        label: 'Global Logs Channel',
        description: 'The channel where all bot logs are sent.',
        type: 'channel',
        defaultValue: '',
      },
      {
        key: 'linked_clans_count',
        label: 'Linked Clans',
        description: 'Number of clans currently linked to this server.',
        type: 'info',
        maxValue: MAX_CLANS_PER_GUILD,
      },
      {
        key: 'linked_family_clans_count',
        label: 'Linked Family Clans',
        description: 'Number of family clans currently linked to this server.',
        type: 'info',
        maxValue: MAX_FAMILY_CLANS_PER_GUILD,
      },
      {
        key: 'linked_players_count',
        label: 'Linked Players',
        description: 'Number of players currently linked to this server.',
        type: 'info',
      },
    ],
  },
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
        defaultValue: MAX_PLAYER_LINKS_PER_USER,
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
        defaultValue: DEFAULT_TICKET_OPENED_IDENTIFIER,
      },
      {
        key: 'closed_identifier',
        label: 'Ticket Closed Text',
        description: 'The text that will appear in closed channels used for tickets.',
        type: 'modal',
        defaultValue: DEFAULT_TICKET_CLOSED_IDENTIFIER,
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
        defaultValue: DEFAULT_DELETE_METHOD,
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
    ],
  },
  member_channels: {
    name: 'member_channels',
    displayName: 'Member Channels',
    description: 'Member channels feature handles everything related to member channels.',
    tableName: 'member_channel_settings',
    defaultEnabled: true,
    settings: [
      {
        key: 'category_id',
        label: 'Category',
        description: 'The category where member channels will be created.',
        type: 'channel',
        defaultValue: '',
      },
      {
        key: 'pin_invite',
        label: 'Pin Invite',
        description: 'Pin the invite message in the member channel. Refresh when invite is regenerated.',
        type: 'toggle',
        defaultValue: false,
      },
      {
        key: 'delete_confirm_count',
        label: 'Delete Confirmations',
        description: 'Number of people needed to delete a channel.',
        type: 'number',
        defaultValue: 2,
      },
      // {
      //   key: 'auto_ping',
      //   label: 'Auto Ping',
      //   description: 'Automatically ping members every 12 hours since the last ping (on training days).',
      //   type: 'toggle',
      //   defaultValue: false,
      // },
      {
        key: 'send_logs',
        label: 'Send Logs',
        description: 'Allow the bot to send log information about member channels.',
        type: 'toggle',
        defaultValue: false,
      },
      {
        key: 'delete_all_channels',
        label: 'Delete All Channels',
        description: 'Delete all current member channels that are not locked, irreversible action.',
        type: 'action',
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
  return Object.entries(FeatureRegistry).reduce(
    (acc, [name, feature]) => {
      acc[name] = feature.defaultEnabled;
      return acc;
    },
    {} as Record<string, boolean>,
  );
}

/**
 * Get feature settings with default values
 */
export function getFeatureDefaultSettings(featureName: string): Record<string, boolean | string | number> {
  const feature = FeatureRegistry[featureName];
  if (!feature) return {};

  return feature.settings.reduce(
    (acc, setting) => {
      if (setting.defaultValue !== undefined) {
        acc[setting.key] = setting.defaultValue;
      }
      return acc;
    },
    {} as Record<string, boolean | string | number>,
  );
}

/**
 * Get all features settings tables and defaults for initialization
 */
export function getFeatureSettingsDefaults(): Record<
  string,
  { table: string; defaults: Record<string, boolean | string | number> }
> {
  return Object.entries(FeatureRegistry).reduce(
    (acc, [name, feature]) => {
      acc[name] = {
        table: feature.tableName,
        defaults: getFeatureDefaultSettings(name),
      };
      return acc;
    },
    {} as Record<string, { table: string; defaults: Record<string, boolean | string | number> }>,
  );
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
  settingKey: string,
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
        `**The \`${settingKey}\` feature for ${feature.displayName} has not been enabled for this guild.**\nPlease ask one of the server admins to enable it in \`/server-settings\``,
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

/**
 * Fetch dynamic info values for a guild (for 'info' type settings)
 */
export async function fetchInfoValue(guildId: string, settingKey: string): Promise<string | number> {
  switch (settingKey) {
    case 'linked_clans_count': {
      const result = await pool.query('SELECT COUNT(*) FROM clans WHERE guild_id = $1', [guildId]);
      return parseInt(result.rows[0]?.count || '0', 10);
    }
    case 'linked_players_count': {
      const result = await pool.query('SELECT COUNT(DISTINCT discord_id) FROM user_playertags WHERE guild_id = $1', [
        guildId,
      ]);
      return parseInt(result.rows[0]?.count || '0', 10);
    }
    case 'linked_family_clans_count': {
      const result = await pool.query(
        `SELECT COUNT(DISTINCT clantag) FROM clans WHERE guild_id = $1 AND family_clan = true`,
        [guildId],
      );
      return parseInt(result.rows[0]?.count || '0', 10);
    }
    case 'max_player_links': {
      return MAX_PLAYER_LINKS_PER_USER;
    }
    default:
      return 'N/A';
  }
}
