import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TopLevelComponent,
  StringSelectMenuBuilder,
  ActionRow,
  MessageActionRowComponent,
  ComponentType,
} from 'discord.js';
import { pool } from '../../db.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';
import { makeCustomId } from '../../utils/customId.js';
import { storeClanSettingsData } from './cache.js';
import { NudgeTrackingScheduler } from '../race-tracking/nudgeScheduler.js';

// Type for nudge schedule settings
interface NudgeSchedule {
  startHour: number | null;
  startMinute: number | null;
  intervalHours: number | null;
}

// The features that will show under /clan-settings
export const CLAN_FEATURE_SETTINGS = [
  {
    key: 'clan_settings',
    label: 'Clan Info',
    buttonLabel: 'Clan Info',
    type: 'grouped_modal',
    group: ['family_clan', 'abbreviation', 'clan_role_id', 'staff_channel_id'],
  },
  {
    key: 'nudge_settings',
    label: 'Race Nudge Settings',
    buttonLabel: 'Nudge Settings',
    type: 'grouped_modal',
    group: ['nudge_enabled', 'race_nudge_channel_id', 'race_nudge_schedule', 'race_custom_nudge_message'],
  },
  {
    key: 'invites_enabled',
    label: 'Show/Generate Clan Invites',
    buttonLabel: 'Invites',
    type: 'toggle',
  },
  {
    key: 'eod_stats_enabled',
    label: 'Auto-Post End-of-Day Stats',
    buttonLabel: 'EOD Stats',
    type: 'toggle',
  },
  {
    key: 'purge_invites',
    label: 'Purge Active Clan Invites',
    buttonLabel: 'Purge Invites',
    type: 'action',
  },
  // ...add more as needed
];

// The default features
export const DEFAULT_CLAN_SETTINGS = {
  nudge_enabled: true,
  race_nudge_channel_id: '',
  race_custom_nudge_message: '',
  eod_stats_enabled: false,
  staff_channel_id: '',
  invites_enabled: true,
  abbreviation: '',
  clan_role_id: '',
  // ...add more as needed, matching your CLAN_FEATURE_SETTINGS keys
};

// Build the clan settings view when a clan is selected in /clan-settings
export async function buildClanSettingsView(guildId: string, clanName: string, clantag: string, ownerId: string) {
  const res = await pool.query(
    `SELECT family_clan, nudge_enabled, race_nudge_channel_id, race_custom_nudge_message, 
            race_nudge_start_hour, race_nudge_start_minute, race_nudge_interval_hours,
            eod_stats_enabled, staff_channel_id, invites_enabled, clan_role_id, abbreviation 
     FROM clans WHERE guild_id = $1 AND clantag = $2`,
    [guildId, clantag],
  );
  if (!res.rowCount) throw new Error('Clan not found');

  // Map database columns to settings object
  const dbRow = res.rows[0];

  const settings: Record<string, boolean | string | number | NudgeSchedule> = {
    family_clan: dbRow.family_clan || false,
    nudge_enabled: dbRow.nudge_enabled || false,
    race_nudge_channel_id: dbRow.race_nudge_channel_id || '',
    race_custom_nudge_message: dbRow.race_custom_nudge_message || '',
    race_nudge_schedule: {
      startHour: dbRow.race_nudge_start_hour,
      startMinute: dbRow.race_nudge_start_minute,
      intervalHours: dbRow.race_nudge_interval_hours,
    },
    eod_stats_enabled: dbRow.eod_stats_enabled || false,
    staff_channel_id: dbRow.staff_channel_id || '',
    invites_enabled: dbRow.invites_enabled || false,
    clan_role_id: dbRow.clan_role_id || '',
    abbreviation: dbRow.abbreviation || '',
  };
  const embed = new EmbedBuilder().setTitle(`Clan Settings: ${clanName}`).setColor(BOTCOLOR);

  let description = '';

  const actionRows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();

  for (const [, settingConfig] of Object.entries(CLAN_FEATURE_SETTINGS)) {
    const value = settings[settingConfig.key];

    // Format value for display
    let displayValue = '';
    if (settingConfig.type === 'toggle') {
      displayValue = value ? '✅ Enabled' : '❌ Disabled';
    } else if (settingConfig.type === 'role') {
      displayValue = value ? `<@&${value}>` : '*None*';
    } else if (settingConfig.type === 'channel') {
      displayValue = value ? `<#${value}>` : '*None*';
    } else if (settingConfig.type === 'grouped_modal') {
      // Special handling for grouped settings - format as bullet list
      if (settingConfig.key === 'nudge_settings') {
        const nudgeEnabled = settings['nudge_enabled'];
        const nudgeChannel = settings['race_nudge_channel_id'];
        const schedule = settings['race_nudge_schedule'] as NudgeSchedule;
        const customMessage = settings['race_custom_nudge_message'];

        const lines: string[] = [];
        lines.push(` * Status: ${nudgeEnabled ? '✅ Enabled' : '❌ Disabled'}`);
        lines.push(` * Channel: ${nudgeChannel ? `<#${nudgeChannel}>` : '*Not set*'}`);

        if (schedule && schedule.startHour !== null && schedule.intervalHours !== null) {
          const { nudgeTimes } = NudgeTrackingScheduler.calculateNudgeContext(
            schedule.startHour,
            schedule.startMinute || 0,
            schedule.intervalHours,
          );
          const now = new Date();
          const todayDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          const timeStrings = nudgeTimes.map((time) => {
            const timestamp = new Date(todayDate);
            timestamp.setUTCHours(time.hour, time.minute, 0, 0);
            const unix = Math.floor(timestamp.getTime() / 1000);
            return `<t:${unix}:t>`;
          });
          lines.push(` * Schedule: ${timeStrings.join(', ')}`);
        } else {
          lines.push(` * Schedule: *Not set*`);
        }

        lines.push(` * Custom Message: ${customMessage ? customMessage : '*Default*'}`);

        displayValue = '\n' + lines.join('\n');
      } else if (settingConfig.key === 'clan_settings') {
        const familyEnabled = settings['family_clan'];
        const abbreviation = settings['abbreviation'];
        const clanRoleId = settings['clan_role_id'];
        const staffChannelId = settings['staff_channel_id'];

        const lines: string[] = [];
        lines.push(` * Family Clan: ${familyEnabled ? '✅ Enabled' : '❌ Disabled'}`);
        lines.push(` * Abbreviation: ${abbreviation ? `__${abbreviation}__` : '*Not set*'}`);
        lines.push(` * Clan Role: ${clanRoleId ? `<@&${clanRoleId}>` : '*Not set*'}`);
        lines.push(` * Staff Channel: ${staffChannelId ? `<#${staffChannelId}>` : '*Not set*'}`);

        displayValue = '\n' + lines.join('\n');
      }
    } else if (settingConfig.type === 'text' || settingConfig.type === 'modal') {
      displayValue = value ? `__${value}__` : '*None*';
    } else if (settingConfig.type === 'action') {
      displayValue = ''; // No value display for action buttons
    }

    if (settingConfig.type !== 'action') {
      description += `**${settingConfig.label}:** ${displayValue}\n`;
    }

    // Build button if editable via button
    let button: ButtonBuilder | null = null;
    const buttonLabel = (settingConfig as any).buttonLabel || settingConfig.label;

    if (settingConfig.type === 'toggle') {
      const cacheKey = storeClanSettingsData({
        settingKey: settingConfig.key,
        clantag,
        clanName,
        guildId,
        ownerId,
      });

      button = new ButtonBuilder()
        .setLabel(`${value ? 'Disable' : 'Enable'} ${buttonLabel}`)
        .setCustomId(makeCustomId('b', 'clanSettings', guildId, { cooldown: 2, extra: [cacheKey], ownerId }))
        .setStyle(ButtonStyle.Primary);
    } else if (settingConfig.type === 'grouped_modal') {
      const cacheKey = storeClanSettingsData({
        settingKey: settingConfig.key,
        clantag,
        clanName,
        guildId,
        ownerId,
      });

      button = new ButtonBuilder()
        .setLabel(`Configure ${buttonLabel}`)
        .setCustomId(makeCustomId('b', 'clanSettingsShowModal', guildId, { extra: [cacheKey], ownerId }))
        .setStyle(ButtonStyle.Secondary);
    } else if (settingConfig.type === 'modal' || settingConfig.type === 'text') {
      const cacheKey = storeClanSettingsData({
        settingKey: settingConfig.key,
        clantag,
        clanName,
        guildId,
        ownerId,
      });

      button = new ButtonBuilder()
        .setLabel(`Edit ${buttonLabel}`)
        .setCustomId(makeCustomId('b', 'clanSettingsShowModal', guildId, { extra: [cacheKey], ownerId }))
        .setStyle(ButtonStyle.Secondary);
    } else if (settingConfig.type === 'role' || settingConfig.type === 'channel') {
      const cacheKey = storeClanSettingsData({
        settingKey: settingConfig.key,
        clantag,
        clanName,
        guildId,
        ownerId,
      });

      button = new ButtonBuilder()
        .setLabel(`Set ${buttonLabel}`)
        .setCustomId(makeCustomId('b', 'clanSettingsShowModal', guildId, { extra: [cacheKey], ownerId }))
        .setStyle(ButtonStyle.Secondary);
    } else if (settingConfig.type === 'action') {
      const cacheKey = storeClanSettingsData({
        settingKey: settingConfig.key,
        clantag,
        clanName,
        guildId,
        ownerId,
      });

      button = new ButtonBuilder()
        .setLabel(buttonLabel)
        .setCustomId(makeCustomId('b', 'clanSettingsAction', guildId, { extra: [cacheKey], ownerId }))
        .setStyle(ButtonStyle.Danger);
    }

    if (button) {
      currentRow.addComponents(button);
    }
    if (currentRow.components.length === 5) {
      actionRows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
  }
  if (currentRow.components.length) actionRows.push(currentRow);

  embed.setDescription(description);

  return { embed, components: actionRows };
}

// Ensure select menu goes last on /clan-settings
export function getSelectMenuRowBuilder(
  components: readonly TopLevelComponent[],
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const selectRow = components.find(
    (row): row is ActionRow<MessageActionRowComponent> =>
      row.type === ComponentType.ActionRow && row.components.some((c) => c.type === ComponentType.StringSelect),
  );

  if (!selectRow) return null;

  const selectMenu = selectRow.components.find((c) => c.type === ComponentType.StringSelect);
  if (!selectMenu || selectMenu.type !== ComponentType.StringSelect) return null;

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(StringSelectMenuBuilder.from(selectMenu));
}
