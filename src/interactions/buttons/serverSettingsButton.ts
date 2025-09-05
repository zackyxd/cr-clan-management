import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, GuildMember, MessageFlags } from 'discord.js';
import pool from '../../db.js';
import { buildCheckHasRoleQuery, checkPermissions } from '../../utils/check_has_role.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';
import { buildSettingsView } from '../../commands/settings_commands/serverSettings.js';
import logger from '../../logger.js';
import { ButtonHandler } from '../../types/Handlers.js';
import { makeCustomId } from '../../utils/customId.js';

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
  // {
  //   key: 'welcome_message',
  //   label: 'Welcome Message',
  //   description: 'Custom welcome message sent when a player links their account.',
  //   type: 'text',
  //   getValue: (settings: any) => settings.welcome_message ?? '*Not set*',
  // },
};
const SETTINGS_TABLES: Record<FeatureKey, string> = {
  links: 'linking_settings',
  tickets: 'ticket_settings',
};

type FeatureKey = keyof typeof FEATURE_SETTINGS;
// 'links' | 'tickets'

const settingsButton: ButtonHandler = {
  customId: 'settings',
  async execute(interaction, parsed) {
    await interaction.deferUpdate();
    const { guildId, extra } = parsed;
    const featureName = extra[0]; // "links"
    const member = (await interaction.guild?.members.fetch(interaction.user.id)) as GuildMember;
    const getRoles = await pool.query(buildCheckHasRoleQuery(guildId));
    const { higher_leader_role_id } = getRoles.rows[0] ?? [];
    // lower_leader_role_id is intentionally omitted
    const requiredRoleIds = [higher_leader_role_id].filter(Boolean) as string[];
    const hasPerms = checkPermissions('button', member, requiredRoleIds);
    if (hasPerms && hasPerms.data) {
      // Returns Promise<Message>, ButtonHandler.execute handled for Promise<void> so await -> return
      await interaction.followUp({ embeds: [hasPerms], flags: MessageFlags.Ephemeral });
      return;
    }

    switch (featureName) {
      case 'links': {
        const { embed, components } = await buildFeatureEmbedAndComponents(
          guildId,
          'links',
          'Links feature handles everything related to linking Discord accounts to their Clash Royale playertags.'
        );
        await interaction.editReply({ embeds: [embed], components });
        break;
      }

      case 'tickets': {
        const { embed, components } = await buildFeatureEmbedAndComponents(
          guildId,
          'tickets',
          'Ticket features handles everything related to tickets and ensuring you can handle new members.'
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
          logger.error(`Error showing server settings: ${error}`);
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
export default settingsButton;

export async function buildFeatureEmbedAndComponents(guildId: string, featureKey: FeatureKey, purpose: string) {
  // console.log(guildId, featureKey, purpose);
  const featureRes = await pool.query(
    `SELECT is_enabled FROM guild_features WHERE guild_id = $1 AND feature_name = $2`,
    [guildId, featureKey]
  );
  const isFeatureEnabled = featureRes.rows[0]?.is_enabled ?? false;

  const tableName = SETTINGS_TABLES[featureKey];
  const settingRes = await pool.query(`SELECT * FROM ${tableName} WHERE guild_id = $1`, [guildId]);
  const settings = settingRes.rows[0] ?? {};

  const titleFeatureKey = featureKey.charAt(0).toUpperCase() + featureKey.substring(1);
  const embed = new EmbedBuilder()
    .setTitle(`${titleFeatureKey} Features: ${isFeatureEnabled ? '✅ Enabled' : '❌ Disabled'}`)
    .setColor(BOTCOLOR);

  const actionRows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();

  const toggleFeature = new ButtonBuilder()
    .setLabel(`${isFeatureEnabled ? 'Disable Feature' : 'Enable Feature'}`)
    .setCustomId(makeCustomId('button', `toggle`, guildId, { cooldown: 1, extra: [`${featureKey}_feature`] }))
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
    if (setting.type === 'text' || setting.type === 'modal') {
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
        .setCustomId(makeCustomId('button', `toggle`, guildId, { cooldown: 1, extra: [setting.key] }))
        .setStyle(ButtonStyle.Primary);
    } else if (setting.type === 'modal') {
      button = new ButtonBuilder()
        .setLabel(`Change ${setting.label}`)
        .setCustomId(makeCustomId('button', 'open_modal', guildId, { cooldown: 1, extra: [setting.key] }))
        // .setCustomId(makeCustomId('modal', setting.key, guildId))
        // .setCustomId(`modal:1:${guildId}:${setting.key}`)
        .setStyle(ButtonStyle.Primary);
    }

    if (button) {
      currentRow.addComponents(button);
    }

    if (currentRow.components.length === 5 || i === featureSettings.length - 1) {
      actionRows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
  }

  embed.setDescription(description);
  return { embed, components: actionRows };
}
