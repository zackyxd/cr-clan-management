import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import { StatsTracker } from '../../services/statsTracker.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { Command } from '../../types/Command.js';

const command: Command = {
  data: new SlashCommandBuilder().setName('stats').setDescription('View bot activity statistics for this server'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;

    if (!guildId) {
      await interaction.editReply({
        content: '❌ This command can only be used in a server.',
      });
      return;
    }

    // Fetch statistics
    const stats = await StatsTracker.get(guildId);

    if (!stats) {
      await interaction.editReply({
        content:
          '❌ No statistics found for this server. Statistics are tracked starting from when the bot was updated.',
      });
      return;
    }

    // Build embed with statistics
    const embed = new EmbedBuilder()
      .setTitle('📊 Bot Activity Statistics')
      .setDescription('Here are the activity statistics for this server')
      .setColor(EmbedColor.SUCCESS)
      .setTimestamp();

    // Member Channels
    embed.addFields({
      name: '📝 Member Channels',
      value:
        `**Created:** ${stats.total_member_channels_created.toLocaleString()}\n` +
        `**Deleted:** ${stats.total_member_channels_deleted.toLocaleString()}`,
      inline: true,
    });

    // Tickets
    embed.addFields({
      name: '🎫 Tickets',
      value:
        `**Tickets with Links:** ${stats.total_tickets_with_playertags_linked.toLocaleString()}\n` +
        `**Total Tags Linked:** ${stats.total_playertags_linked_from_tickets.toLocaleString()}`,
      inline: true,
    });

    // Nudges
    embed.addFields({
      name: '📢 Nudges',
      value: `**Total Sent:** ${stats.total_nudges_sent.toLocaleString()}`,
      inline: true,
    });

    // Invites
    embed.addFields({
      name: '📬 Clan Invites',
      value: `**Messages Sent:** ${stats.total_invite_messages_sent.toLocaleString()}`,
      inline: true,
    });

    // Interactions
    embed.addFields({
      name: '🎮 Interactions',
      value:
        `**Commands Used:** ${stats.total_commands_used.toLocaleString()}\n` +
        `**Buttons Clicked:** ${stats.total_buttons_clicked.toLocaleString()}\n` +
        `**Modals Submitted:** ${stats.total_modals_submitted.toLocaleString()}`,
      inline: true,
    });

    // Add footer with start date
    embed.setFooter({ text: `Tracking started on ${new Date(stats.created_at).toLocaleDateString()}` });

    await interaction.editReply({ embeds: [embed] });
  },
};

// export default command;
