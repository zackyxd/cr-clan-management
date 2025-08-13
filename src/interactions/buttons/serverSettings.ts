import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, GuildMember } from 'discord.js';
import pool from '../../db.js';
import { buildCheckHasRoleQuery, checkPermissions } from '../../utils/check_has_role.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';
import { buildSettingsView } from '../../commands/settings_commands/serverSettings.js';
import logger from '../../logger.js';

export const LINK_FEATURES = [
  {
    key: 'rename_players',
    label: 'Auto Rename',
    description: 'Automatically rename linked users to match their in-game name.',
    type: 'toggle',
  },
  // {
  //   key: 'welcome_message',
  //   label: 'Welcome Message',
  //   description: 'Custom welcome message sent when a player links their account.',
  //   type: 'text',
  //   getValue: (settings: any) => settings.welcome_message ?? '*Not set*',
  // },
];

export default {
  customId: 'settings',
  async execute(interaction: ButtonInteraction, args: string[]) {
    await interaction.deferUpdate();
    const [guildId, settingName] = args;
    console.log(guildId, settingName);
    const member = (await interaction.guild?.members.fetch(interaction.user.id)) as GuildMember;
    const getRoles = await pool.query(buildCheckHasRoleQuery(guildId));
    console.log(getRoles);
    const { higher_leader_role_id } = getRoles.rows[0];
    // lower_leader_role_id is intentionally omitted
    const requiredRoleIds = [higher_leader_role_id].filter(Boolean) as string[];
    const hasPerms = checkPermissions('button', member, requiredRoleIds);
    if (hasPerms && hasPerms.data) {
      return await interaction.followUp({ embeds: [hasPerms], ephemeral: true });
    }

    switch (settingName) {
      case 'links': {
        const { embed, components } = await buildFeatureEmbedAndComponents(
          guildId,
          'links',
          'Links feature handles everything related to linking Discord accounts to their Clash Royale playertags.'
        );
        await interaction.editReply({ embeds: [embed], components });
        break;
      }

      case 'return': {
        const { embed, components } = await buildSettingsView(guildId);
        try {
          interaction.editReply({
            embeds: [embed],
            components: components,
          });
        } catch (error) {
          logger.error(`Error showign server settings: ${error}`);
          interaction.editReply({ content: `Error showing settings. @Zacky to fix` });
          return;
        }
        break;
      }

      default: {
        break;
      }
    }
  },
};

export async function buildFeatureEmbedAndComponents(guildId: string, featureKey: string, purpose: string) {
  const featureRes = await pool.query(
    `SELECT is_enabled FROM guild_features WHERE guild_id = $1 AND feature_name = $2`,
    [guildId, featureKey]
  );
  const isFeatureEnabled = featureRes.rows[0]?.is_enabled ?? false;

  const settingRes = await pool.query(`SELECT * FROM linking_settings WHERE guild_id = $1`, [guildId]);
  const settings = settingRes.rows[0] ?? {};

  const titleFeatureKey = featureKey.charAt(0).toUpperCase() + featureKey.substring(1);
  const embed = new EmbedBuilder()
    .setTitle(`${titleFeatureKey} Features: ${isFeatureEnabled ? '✅ Enabled' : '❌ Disabled'}`)
    .setColor(BOTCOLOR);

  const actionRows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();

  const toggleFeature = new ButtonBuilder()
    .setLabel(`${isFeatureEnabled ? 'Disable Feature' : 'Enable Feature'}`)
    .setCustomId(`toggle:1:${guildId}:${featureKey}_feature`)
    .setStyle(ButtonStyle.Primary);

  const returnToSettings = new ButtonBuilder()
    .setEmoji('↩')
    .setStyle(ButtonStyle.Primary)
    .setCustomId(`settings:1:${guildId}:return`);
  currentRow.addComponents(returnToSettings);
  currentRow.addComponents(toggleFeature);

  // let description = '';
  let description = `*${purpose}*\n\n\n`;

  for (const [i, setting] of LINK_FEATURES.entries()) {
    const value = settings[setting.key];

    const displayValue =
      setting.type === 'text' ? `**Current:** ${value || '*None*'}` : value ? '✅ Enabled' : '❌ Disabled';

    description += `* **${setting.label}: ${displayValue}**\n`;
    description += `  * ${setting.description}\n\n`;

    if (setting.type !== 'text') {
      const button = new ButtonBuilder()
        .setLabel(`${value ? 'Disable' : 'Enable'} ${setting.label}`)
        .setCustomId(`toggle:1:${guildId}:${setting.key}`)
        .setStyle(ButtonStyle.Primary);

      currentRow.addComponents(button);

      if ((i + 1) % 5 === 0 || i === LINK_FEATURES.length - 1) {
        actionRows.push(currentRow);
        currentRow = new ActionRowBuilder<ButtonBuilder>();
      }
    }
  }

  embed.setDescription(description);
  return { embed, components: actionRows };
}
