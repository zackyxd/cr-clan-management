import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
  ButtonStyle,
  InteractionContextType,
  ActionRowBuilder,
} from 'discord.js';
import pool from '../../db.js';
import { Command } from '../../types/Command.js';
import { ButtonBuilder, EmbedBuilder } from '@discordjs/builders';
import { BOTCOLOR } from '../../types/EmbedUtil.js';
import logger from '../../logger.js';
import { makeCustomId } from '../../utils/customId.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('server-settings')
    .setDescription('Change settings for some of the bot features')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();

    const { embed, components } = await buildSettingsView(guild.id);

    try {
      interaction.editReply({
        embeds: [embed],
        components: components,
      });
    } catch (error) {
      logger.info(`Could not show /server-settings: ${error}`);
      interaction.editReply({ content: `Error showing settings. @Zacky to fix` });
      return;
    }
  },
};

export async function buildSettingsView(guildId: string) {
  const settingsRes = await pool.query(
    `
      SELECT feature_name, is_enabled
      FROM guild_features
      WHERE guild_id = $1
      `,
    [guildId]
  );

  const guildFeatures = settingsRes.rows;
  guildFeatures.sort((a, b) => a.feature_name.localeCompare(b.feature_name));

  const embed = new EmbedBuilder().setTitle('Features List').setColor(BOTCOLOR);
  let description = '';
  const actionRows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();
  for (const [i, feature] of guildFeatures.entries()) {
    const { feature_name, is_enabled } = feature;
    const formatted_name = feature_name.charAt(0).toUpperCase() + feature_name.slice(1);
    description += `${formatted_name} ${is_enabled ? '✅' : '❌'}\n`;

    // Goes to buttons/serverSettings
    const button = new ButtonBuilder()
      .setCustomId(makeCustomId('button', 'settings', guildId, { cooldown: 1, extra: [feature_name] }))
      .setLabel(`${formatted_name}`)
      .setStyle(ButtonStyle.Primary);
    currentRow.addComponents(button);

    if (currentRow.components.length === 5 || i === guildFeatures.length - 1) {
      actionRows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
  }
  embed.setDescription(description);
  return { embed, components: actionRows };
}

export default command;
