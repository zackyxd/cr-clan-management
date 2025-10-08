import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { pool } from '../../db.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { Command } from '../../types/Command.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('set-ticket-log-channel')
    .setDescription('Channel for ticket logs to go to (must enable in settings)')
    .addChannelOption((option) =>
      option.setName('channel').setDescription('Channel for logs to be sent to').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.options.getChannel('channel');
    await pool.query(
      `
        UPDATE ticket_settings
        SET logs_channel_id = $1
        WHERE guild_id = $2
        `,
      [channel?.id, guild.id]
    );

    const checkAdded = await pool.query(
      `
      SELECT logs_channel_id
      FROM ticket_settings
      WHERE guild_id = $1
      `,
      [guild.id]
    );

    let successfullyAdded = false;
    if (checkAdded.rows[0]['logs_channel_id'] === channel?.id) {
      successfullyAdded = true;
    }

    let description: string = '';
    let embedColor: EmbedColor = EmbedColor.WARNING;
    if (successfullyAdded) {
      description = `Successfully added ${channel} to be used as the log channel for tickets.`;
      embedColor = EmbedColor.SUCCESS;
    } else {
      description = `Error making ${channel} the log channel for tickets.`;
      embedColor = EmbedColor.FAIL;
    }

    const embed = new EmbedBuilder().setDescription(description).setColor(embedColor);
    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
