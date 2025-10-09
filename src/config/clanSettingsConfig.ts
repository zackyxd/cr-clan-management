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
import { pool } from '../db.js';
import { BOTCOLOR } from '../types/EmbedUtil.js';
import { makeCustomId } from '../utils/customId.js';

// The features that will show under /clan-settings
export const CLAN_FEATURE_SETTINGS = [
  {
    key: 'family_clan',
    label: 'Family Clan',
    description: 'Make this clan part of your clan family.',
    type: 'toggle',
  },
  {
    key: 'nudge_enabled',
    label: 'Nudges',
    description: 'Send pings for clan nudges automatically.',
    type: 'toggle',
  },
  {
    key: 'invites_enabled',
    label: 'Invites',
    description: "Show this clan's invite in the invites channel and ability to generate them for members.",
    type: 'toggle',
  },
  {
    key: 'abbreviation',
    label: 'Abbreviation',
    description: 'Short tag or nickname for the clan.',
    type: 'modal',
  },
  {
    key: 'clan_role_id',
    label: 'Clan Role',
    description: 'Role used for this clan',
    type: 'role',
  },
  {
    // TODO add this to the settings
    key: 'purge_invites',
    label: 'Purge Invites',
    description: 'Purge any active clan invites sent',
    type: 'action',
  },
  // ...add more as needed
];

// The default features
export const DEFAULT_CLAN_SETTINGS = {
  nudge_enabled: false,
  invites_enabled: true,
  abbreviation: '',
  clan_role_id: '',
  // ...add more as needed, matching your CLAN_FEATURE_SETTINGS keys
};

// Build the clan settings view when a clan is selected in /clan-settings
export async function buildClanSettingsView(guildId: string, clanName: string, clantag: string, ownerId: string) {
  const res = await pool.query(`SELECT settings FROM clan_settings WHERE guild_id = $1 AND clantag = $2`, [
    guildId,
    clantag,
  ]);
  if (!res.rowCount) throw new Error('Clan not found');
  const settings = { ...DEFAULT_CLAN_SETTINGS, ...(res.rows[0].settings ?? {}) };
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
    } else if (settingConfig.type === 'text' || settingConfig.type === 'modal') {
      displayValue = value ? `__${value}__` : '*None*';
    }

    description += `* **${settingConfig.label}: ${displayValue}**\n  * ${settingConfig.description}\n\n`;

    // Build button if editable via button
    let button: ButtonBuilder | null = null;
    if (settingConfig.type === 'toggle') {
      button = new ButtonBuilder()
        .setLabel(`${value ? 'Disable' : 'Enable'} ${settingConfig.label}`)
        .setCustomId(
          makeCustomId('button', 'clanSettings', guildId, { cooldown: 2, extra: [settingConfig.key, clantag], ownerId })
        )
        .setStyle(ButtonStyle.Primary);
    } else if (settingConfig.type === 'modal' || settingConfig.type === 'text') {
      button = new ButtonBuilder()
        .setLabel(`Edit ${settingConfig.label}`)
        .setCustomId(makeCustomId('button', 'open_modal', guildId, { extra: [settingConfig.key, clantag], ownerId }))
        .setStyle(ButtonStyle.Secondary);
    } else if (settingConfig.type === 'role') {
      button = new ButtonBuilder()
        .setLabel(`Edit ${settingConfig.label}`)
        .setCustomId(
          makeCustomId('button', 'open_modal', guildId, { extra: [settingConfig.key, clantag, clanName], ownerId })
        )
        .setStyle(ButtonStyle.Secondary);
    }
    // For 'role', you might want to use a slash command or a select menu, so you can just show info.

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
  components: readonly TopLevelComponent[]
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const selectRow = components.find(
    (row): row is ActionRow<MessageActionRowComponent> =>
      row.type === ComponentType.ActionRow && row.components.some((c) => c.type === ComponentType.StringSelect)
  );

  if (!selectRow) return null;

  const selectMenu = selectRow.components.find((c) => c.type === ComponentType.StringSelect);
  if (!selectMenu || selectMenu.type !== ComponentType.StringSelect) return null;

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(StringSelectMenuBuilder.from(selectMenu));
}
