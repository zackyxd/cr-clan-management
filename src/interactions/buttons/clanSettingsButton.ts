import {
  ActionRow,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageActionRowComponent,
  StringSelectMenuBuilder,
  TopLevelComponent,
} from 'discord.js';
import pool from '../../db.js';
import { ButtonHandler } from '../../types/Handlers.js';
import { makeCustomId } from '../../utils/customId.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';
import { CLAN_FEATURE_SETTINGS, DEFAULT_CLAN_SETTINGS } from '../../config/clanSettingsConfig.js';
import { fetchClanName } from '../../services/clans.js';
import logger from '../../logger.js';
import { checkPerms } from '../../utils/checkPermissions.js';

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
        .setCustomId(makeCustomId('button', 'clanSettings', guildId, { extra: [settingConfig.key, clantag], ownerId }))
        .setStyle(ButtonStyle.Primary);
    } else if (settingConfig.type === 'modal' || settingConfig.type === 'text') {
      button = new ButtonBuilder()
        .setLabel(`Edit ${settingConfig.label}`)
        .setCustomId(makeCustomId('button', 'open_modal', guildId, { extra: [settingConfig.key, clantag], ownerId }))
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

const clanSettingsButton: ButtonHandler = {
  customId: 'clanSettings',
  async execute(interaction, parsed) {
    const { guildId, extra } = parsed;
    const featureName = extra[0]; // 'nudges',
    const clantag = extra[1];

    const allowed = await checkPerms(interaction, guildId, 'button', 'either', { hideNoPerms: true });
    if (!allowed) return; // no perms

    switch (featureName) {
      case 'family_clan': {
        const client = await pool.connect();

        try {
          await client.query('BEGIN');

          // 1️⃣ Fetch current settings
          const res = await client.query(`SELECT settings FROM clan_settings WHERE guild_id = $1 AND clantag = $2`, [
            guildId,
            clantag,
          ]);
          const currentSettings = { ...DEFAULT_CLAN_SETTINGS, ...(res.rows[0]?.settings ?? {}) };

          // 2️⃣ Toggle the setting
          currentSettings.family_clan = !currentSettings.family_clan;

          // 3️⃣ Update clan_settings JSONB
          await client.query(`UPDATE clan_settings SET settings = $1 WHERE guild_id = $2 AND clantag = $3`, [
            currentSettings,
            guildId,
            clantag,
          ]);

          // 4️⃣ Update the clans table
          await client.query(`UPDATE clans SET family_clan = $1 WHERE guild_id = $2 AND clantag = $3`, [
            currentSettings.family_clan,
            guildId,
            clantag,
          ]);

          // ✅ Commit transaction
          await client.query('COMMIT');
        } catch (error) {
          // ❌ Rollback if anything fails
          await client.query('ROLLBACK');
          logger.error('Error toggling family_clan:', error);
          await interaction.followUp({ content: 'There was an error setting this clan as family clan.' });
        } finally {
          // Release client back to the pool
          client.release();
        }

        const clanName = await fetchClanName(guildId, clantag);

        // Find the select menu row in the current message
        const selectMenuRowBuilder = getSelectMenuRowBuilder(interaction.message.components);
        // Build new button rows
        const { embed, components: newButtonRows } = await buildClanSettingsView(
          guildId,
          clanName,
          clantag,
          interaction.user.id
        );

        // Replace all components with the new ones
        await interaction.editReply({
          embeds: [embed],
          components: selectMenuRowBuilder
            ? [...newButtonRows, selectMenuRowBuilder] // ✅ select menu goes last
            : newButtonRows,
        });
        break;
      }

      case 'nudge_enabled': {
        const res = await pool.query(`SELECT settings FROM clan_settings WHERE guild_id = $1 AND clantag = $2`, [
          guildId,
          clantag,
        ]);
        const currentSettings = { ...DEFAULT_CLAN_SETTINGS, ...(res.rows[0]?.settings ?? {}) };

        currentSettings.nudge_enabled = !currentSettings.nudge_enabled;

        await pool.query(`UPDATE clan_settings SET settings = $1 WHERE guild_id = $2 AND clantag = $3`, [
          currentSettings,
          guildId,
          clantag,
        ]);

        const clanName = await fetchClanName(guildId, clantag);

        // Find the select menu row in the current message
        const selectMenuRowBuilder = getSelectMenuRowBuilder(interaction.message.components);
        // Build new button rows
        const { embed, components: newButtonRows } = await buildClanSettingsView(
          guildId,
          clanName,
          clantag,
          interaction.user.id
        );

        // Replace all components with the new ones
        await interaction.editReply({
          embeds: [embed],
          components: selectMenuRowBuilder
            ? [...newButtonRows, selectMenuRowBuilder] // ✅ select menu goes last
            : newButtonRows,
        });

        break;
      }
      case 'invites_enabled': {
        const res = await pool.query(`SELECT settings FROM clan_settings WHERE guild_id = $1 AND clantag = $2`, [
          guildId,
          clantag,
        ]);
        const currentSettings = { ...DEFAULT_CLAN_SETTINGS, ...(res.rows[0]?.settings ?? {}) };

        currentSettings.invites_enabled = !currentSettings.invites_enabled;

        await pool.query(`UPDATE clan_settings SET settings = $1 WHERE guild_id = $2 AND clantag = $3`, [
          currentSettings,
          guildId,
          clantag,
        ]);

        const clanName = await fetchClanName(guildId, clantag);

        // Find the select menu row in the current message
        const selectMenuRowBuilder = getSelectMenuRowBuilder(interaction.message.components);
        // Build new button rows
        const { embed, components: newButtonRows } = await buildClanSettingsView(
          guildId,
          clanName,
          clantag,
          interaction.user.id
        );

        // Replace all components with the new ones
        await interaction.editReply({
          embeds: [embed],
          components: selectMenuRowBuilder
            ? [...newButtonRows, selectMenuRowBuilder] // ✅ select menu goes last
            : newButtonRows,
        });

        break;
      }
    }
  },
};

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

export default clanSettingsButton;
