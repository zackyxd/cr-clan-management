import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { checkFeature } from '../../utils/checkFeatureEnabled.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('check')
    .setDescription('(Coleader+) Use this inside of a member channel to manage it.'),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Implementation for member channel check command
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const featureCheck = await checkFeature(interaction, guild.id, 'member_channels');
    if (!featureCheck) {
      return;
    }

    const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });

    if (!allowed) return;

    const validChannelSQL = await pool.query(
      `
      SELECT channel_id
      FROM member_channels
      WHERE guild_id = $1 AND channel_id = $2
      `,
      [guild.id, interaction.channelId]
    );
    const res = validChannelSQL.rows[0];

    if (!res) {
      await interaction.editReply({
        content: '❌ This command can only be used inside of a member channel.',
      });
      return;
    }

    const checkMemberButton = new ButtonBuilder()
      .setLabel('Check Members')
      .setCustomId('check_members')
      .setStyle(ButtonStyle.Primary);
    const pingMemberButton = new ButtonBuilder()
      .setLabel('Ping Missing Members')
      .setCustomId('ping_members')
      .setStyle(ButtonStyle.Primary);
    const addMemberToChannel = new ButtonBuilder()
      .setLabel('Add Member')
      .setCustomId('add_member')
      .setStyle(ButtonStyle.Primary);
    const removeMemberToChannel = new ButtonBuilder()
      .setLabel('Remove Member')
      .setCustomId('remove_member')
      .setStyle(ButtonStyle.Primary);
    const deleteChannelButton = new ButtonBuilder()
      .setLabel('Delete Channel')
      .setCustomId('delete_member_channel')
      .setStyle(ButtonStyle.Danger);

    const testEmbed = new EmbedBuilder()
      .setTitle('Clash of Clams Check')
      .setDescription('Example text\nClash of Clams\nCurrent Members: 47/50\nMissing Members: 3/8');

    await interaction.editReply({
      embeds: [testEmbed],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          checkMemberButton,
          pingMemberButton,
          addMemberToChannel,
          removeMemberToChannel,
          deleteChannelButton
        ),
      ],
    });
  },
};

export default command;
