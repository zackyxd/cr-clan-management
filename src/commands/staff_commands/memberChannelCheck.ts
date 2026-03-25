import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, ChannelType } from 'discord.js';
import { checkFeature } from '../../utils/checkFeatureEnabled.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';
import { buildMemberChannelCheckUI } from '../../utils/memberChannelCheckHelpers.js';

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

    // Ensure channel is a guild text channel, not a DM
    if (!interaction.channel || interaction.channel.type === ChannelType.DM) {
      await interaction.reply({
        content: '❌ This command must be used in a server channel.',
        flags: MessageFlags.Ephemeral,
      });
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
      SELECT mc.channel_id, mc.clantag_focus, mc.clan_name_focus, mc.members, mc.last_ping, mc.current_delete_count, mc.delete_confirmed_by,
             COALESCE(mcs.delete_confirm_count, 2) as delete_confirm_count, mc.is_locked
      FROM member_channels mc
      LEFT JOIN member_channel_settings mcs ON mc.guild_id = mcs.guild_id
      WHERE mc.guild_id = $1 AND mc.channel_id = $2
      `,
      [guild.id, interaction.channelId],
    );
    const res = validChannelSQL.rows[0];
    console.log(res);
    if (!res) {
      await interaction.editReply({
        content: '❌ This command can only be used inside of a member channel.',
      });
      return;
    }

    const { embed, components } = await buildMemberChannelCheckUI(res, guild.id);

    await interaction.editReply({
      embeds: [embed],
      components,
    });
  },
};

export default command;
