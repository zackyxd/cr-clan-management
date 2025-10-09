// Key: same name as in db
// label: How it shows for 'Disable/Enable ...', 'Change ...'
// Description: Describe what it does
// type: Which method to use when button clicked

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { pool } from '../db.js';
import { BOTCOLOR } from '../types/EmbedUtil.js';
import { makeCustomId } from '../utils/customId.js';

const EMBED_SERVER_FEATURE_CONFIG = {
  ticket_settings: {
    displayName: 'tickets',
    description: 'Ticket features handles everything related to tickets and ensuring you can handle new members.',
  },
  clan_invite_settings: {
    displayName: 'clan_invites',
    description: 'Clan invite settings manage how invites are handled and displayed.',
  },
  link_settings: {
    displayName: 'links',
    description:
      'Links feature handles everything related to linking Discord accounts to their Clash Royale playertags.',
  },
} as const;

export default EMBED_SERVER_FEATURE_CONFIG;

// Used to set global features for server settings
export const FEATURE_SETTINGS = {
  links: [
    {
      key: 'rename_players', // done
      label: 'Auto Rename',
      description: 'Automatically rename linked users to match their in-game name.',
      type: 'toggle',
    },
    {
      key: 'max_links',
      label: 'Max Links',
      description: 'Max amount of playertags linked to each @user',
      type: 'number',
    },
  ],
  tickets: [
    {
      key: 'opened_identifier', // done
      label: 'Ticket Created Text',
      description: 'The text that will appear in created channels used for tickets.',
      type: 'modal',
    },
    {
      key: 'closed_identifier', // done
      label: 'Ticket Closed Text',
      description: 'The text that will appear in closed channels used for tickets.',
      type: 'modal',
    },
    {
      key: 'allow_append',
      label: 'Append to ticket',
      description:
        'Allow the bot to append text to the channel name. Coleaders+ can use `/append` inside of the channel to add to it.',
      type: 'toggle',
    },
    {
      key: 'send_logs',
      label: 'Send Logs',
      description: 'Allow the bot to send log information about tickets.',
      type: 'toggle',
    },
    {
      key: 'logs_channel_id',
      label: 'Logs Channel',
      description:
        'Which channel do you want to send logs to? Use `/set-ticket-log-channel` command to set the channel.',
      type: 'channel',
    },
  ],
  clan_invites: [
    {
      key: 'pin_message',
      label: 'Pin Message',
      description: 'Keep the clan invites message pinned.',
      type: 'toggle',
    },
    {
      key: 'delete_method',
      label: 'Expiry method',
      description: 'Switch how expire generated links are handled. Delete the messages or edit them.',
      type: 'swap',
    },
    {
      key: 'show_inactive',
      label: 'Inactive Links',
      description: 'Show the inactive links on the clan invites message.',
      type: 'toggle',
    },
    {
      key: 'ping_expired',
      label: 'Ping Expired',
      description: 'Ping the clan role in the clan invites channel to notify that a new link is needed.',
      type: 'toggle',
    },
    {
      key: 'send_logs',
      label: 'Send Logs',
      description: 'Allow the bot to send log information about clan invites.',
      type: 'toggle',
    },
    {
      key: 'logs_channel_id',
      label: 'Logs Channel',
      description:
        'Which channel do you want to send logs to? Use `/set-invites-log-channel` command to set the channel.',
      type: 'channel',
    },
  ],
  //     key: '',
  //     label: '',
  //     description: '',
  //     type: ''
  // {
  //   key: 'welcome_message',
  //   label: 'Welcome Message',
  //   description: 'Custom welcome message sent when a player links their account.',
  //   type: 'text',
  //   getValue: (settings: any) => settings.welcome_message ?? '*Not set*',
  // },
};
export const SETTINGS_TABLES: Record<FeatureKey, string> = {
  links: 'link_settings',
  tickets: 'ticket_settings',
  clan_invites: 'clan_invite_settings',
};

export type FeatureKey = keyof typeof FEATURE_SETTINGS;

// Build the server settings embed from scratch given the feature key from above
export async function buildServerFeatureEmbedAndComponents(
  guildId: string,
  ownerId: string,
  featureKey: FeatureKey,
  purpose: string
) {
  // console.log(guildId, featureKey, purpose);
  const featureRes = await pool.query(
    `SELECT is_enabled FROM guild_features WHERE guild_id = $1 AND feature_name = $2`,
    [guildId, featureKey]
  );
  const isFeatureEnabled = featureRes.rows[0]?.is_enabled ?? false;

  const tableName = SETTINGS_TABLES[featureKey];
  const settingRes = await pool.query(`SELECT * FROM ${tableName} WHERE guild_id = $1`, [guildId]);
  const settings = settingRes.rows[0] ?? {};

  const titleFeatureKey = featureKey
    .split('_') // ['clan', 'invites']
    .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)) // ['Clan', 'Invites']
    .join(' '); // 'Clan Invites'
  const embed = new EmbedBuilder()
    .setTitle(`${titleFeatureKey} Features: ${isFeatureEnabled ? '✅ Enabled' : '❌ Disabled'}`)
    .setColor(BOTCOLOR);

  const actionRows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();

  const toggleFeature = new ButtonBuilder()
    .setLabel(`${isFeatureEnabled ? 'Disable Feature' : 'Enable Feature'}`)
    .setCustomId(
      makeCustomId('button', `toggle`, guildId, { cooldown: 1, extra: [`${featureKey}_feature`, tableName] })
    )
    // .setCustomId(`toggle:1:${guildId}:${featureKey}_feature`)
    .setStyle(ButtonStyle.Primary);

  const returnToSettings = new ButtonBuilder()
    .setEmoji('↩')
    .setStyle(ButtonStyle.Primary)
    .setCustomId(makeCustomId(`button`, 'settings', guildId, { cooldown: 1, extra: ['return'] }));
  // .setCustomId(`settings:1:${guildId}:return`);
  currentRow.addComponents(returnToSettings, toggleFeature);

  let description = `*${purpose}*\n\n\n`;
  const featureSettings = FEATURE_SETTINGS[featureKey] ?? [];
  for (const [i, setting] of featureSettings.entries()) {
    const value = settings[setting.key];
    let displayValue: string = '';
    if (setting.type === 'text' || setting.type === 'modal' || setting.type === 'swap') {
      displayValue = `__${value || '*None*'}__`;
    } else if (setting.type === 'toggle') {
      displayValue = value ? '✅ Enabled' : '❌ Disabled';
    } else if (setting.type === 'channel') {
      displayValue = value ? `<#${value}>` : '*None*';
    } else if (setting.type === 'number') {
      displayValue = value;
    }
    // displayValue = setting.type === 'text' ? `**Current:** ${value || '*None*'}` : value ? '✅ Enabled' : '❌ Disabled';

    description += `* **${setting.label}: ${displayValue}**\n`;
    description += `  * ${setting.description}\n\n`;
    // console.log(setting.type);
    let button: ButtonBuilder | null = null;

    if (setting.type === 'toggle') {
      button = new ButtonBuilder()
        .setLabel(`${value ? 'Disable' : 'Enable'} ${setting.label}`)
        .setCustomId(
          makeCustomId('button', `toggle`, guildId, { cooldown: 1, extra: [setting.key, tableName], ownerId: ownerId })
        ) // extra = 'send_logs', table_name
        .setStyle(ButtonStyle.Primary);
    } else if (setting.type === 'modal') {
      button = new ButtonBuilder()
        .setLabel(`Change ${setting.label}`)
        .setCustomId(
          makeCustomId('button', 'open_modal', guildId, {
            cooldown: 1,
            extra: [setting.key],
            ownerId: ownerId,
          })
        )
        .setStyle(ButtonStyle.Primary);
    } else if (setting.type === 'swap') {
      button = new ButtonBuilder()
        .setLabel(`Swap ${setting.label}`)
        .setCustomId(
          makeCustomId('button', 'swap', guildId, { cooldown: 1, extra: [setting.key, tableName], ownerId: ownerId })
        )
        .setStyle(ButtonStyle.Primary);
    }

    if (button) {
      currentRow.addComponents(button);
    }

    if (currentRow.components.length === 5 || i === featureSettings.length - 1) {
      if (currentRow.components.length > 0) {
        actionRows.push(currentRow);
      }
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
  }

  embed.setDescription(description);
  return { embed, components: actionRows };
}
