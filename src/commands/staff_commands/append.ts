import { ChatInputCommandInteraction, EmbedBuilder, GuildMember, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import pool from '../../db.js';
import { buildCheckHasRoleQuery, checkPermissions } from '../../utils/check_has_role.js';
import { checkTicketFeatureEnabled } from '../../utils/checkFeatureEnabled.js';
import { EmbedColor } from '../../types/EmbedUtil.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('append')
    .setDescription('Append text to the current ticket channel name')
    .addStringOption((option) =>
      option.setName('text').setDescription('Text you want to add to the channel name').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    const userId = interaction.user.id;

    if (!guild) {
      await interaction.reply({
        content: '❌ This command must be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const check = await checkTicketFeatureEnabled(guild.id, 'allow_append');
    if (!check.enabled) {
      if (check.embed) {
        await interaction.reply({ embeds: [check.embed], flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({
          content: 'Error showing embed for feature not enabled. Contact @Zacky',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    const member = interaction.member instanceof GuildMember ? interaction.member : await guild.members.fetch(userId);

    const getRoles = await pool.query(buildCheckHasRoleQuery(guild.id));
    const { lower_leader_role_id, higher_leader_role_id } = getRoles.rows[0] ?? [];
    const requiredRoleIds = [lower_leader_role_id, higher_leader_role_id].filter(Boolean) as string[];
    const hasPerms = await checkPermissions('command', member, requiredRoleIds);
    if (hasPerms && hasPerms.data) {
      await interaction.reply({ embeds: [hasPerms], flags: MessageFlags.Ephemeral });
      return;
    }

    const textWanted = interaction.options.getString('text');

    const channel = await interaction.guild.channels.fetch(interaction.channelId);
    const originalChannelName = channel?.name;
    if (!originalChannelName) return;

    // Fetch ticket info
    const { rows } = await pool.query(
      `
      SELECT initial_ticket_name, appended_at
      FROM tickets
      WHERE guild_id = $1 AND channel_id = $2
      `,
      [guild.id, interaction.channelId]
    );

    if (rows.length === 0) {
      await interaction.reply({
        content: 'This is not a channel you can append to. It must be a ticket channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ticket = rows[0];

    const now = new Date();
    if (ticket?.appended_at) {
      const diff = now.getTime() - new Date(ticket.appended_at).getTime();
      if (diff < 10 * 60 * 1000) {
        // 10 minutes
        await interaction.reply({
          content: '⚠️ You can only append to the ticket name once every 10 minutes.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const originalName = ticket?.initial_ticket_name ?? channel?.name ?? '';

    // Append the new text
    const newName = originalName + ' ' + textWanted;

    try {
      await channel?.setName(newName);
      if (originalChannelName === channel.name) {
        await interaction.editReply(
          "The channel name was unable to be changed due to Discord's limit. Try again in 10 minutes."
        );
        return;
      }
      await pool.query(
        `
        UPDATE tickets
        SET 
          initial_ticket_name = COALESCE(initial_ticket_name, $1),
          appended_name = $2, 
          appended_at = NOW()
        WHERE guild_id = $3 AND channel_id = $4
        `,
        [originalChannelName, textWanted, guild.id, interaction.channelId]
      );
      const embed = new EmbedBuilder()
        .setDescription(`Successfully changed the ticket name to \`${newName}\``)
        .setColor(EmbedColor.SUCCESS);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.log(error);
    }
  },
};

export default command;
