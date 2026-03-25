import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  TextChannel,
} from 'discord.js';
import { ticketService } from '../../features/tickets/service.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { Command } from '../../types/Command.js';
import { makeCustomId } from '../../utils/customId.js';
import { sendTicketButton } from '../../features/tickets/events/channelCreate.js';

const command: Command = {
  data: new SlashCommandBuilder().setName('ticket').setDescription('View information about the current ticket'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId;
    const channelId = interaction.channelId;

    if (!guildId) {
      await interaction.editReply({
        content: '❌ This command can only be used in a server.',
      });
      return;
    }

    // Check if tickets feature is enabled
    const featureCheck = await ticketService.isFeatureEnabled(guildId);
    if (!featureCheck.enabled) {
      await interaction.editReply({
        content: '❌ The ticket system is not enabled on this server.',
      });
      return;
    }

    // Get ticket data for this channel
    const ticketData = await ticketService.getTicketData(guildId, channelId);

    if (!ticketData) {
      await interaction.editReply({
        content:
          '❌ This channel is not a ticket. Use this command inside a ticket channel.\nIf this is a ticket, playertags must be entered first using the button below.',
      });
      if (interaction.channel instanceof TextChannel) {
        await sendTicketButton(interaction.channel, guildId);
      }
      return;
    }

    // Build embed with ticket information
    const embed = new EmbedBuilder()
      .setTitle('🎫 Ticket Information')
      .setColor(ticketData.isClosed ? EmbedColor.WARNING : EmbedColor.SUCCESS)
      .addFields(
        {
          name: '📊 Status',
          value: ticketData.isClosed ? '🔴 Closed' : '🟢 Open',
          inline: true,
        },
        {
          name: '📅 Created At',
          value: `<t:${Math.floor(new Date(ticketData.createdAt || Date.now()).getTime() / 1000)}:F>`,
          inline: true,
        },
      );

    // Add creator info
    if (ticketData.createdBy) {
      embed.addFields({
        name: '👤 Created By',
        value: `<@${ticketData.createdBy}>`,
        inline: true,
      });
    }

    // Add closed info if applicable
    if (ticketData.isClosed && ticketData.closedAt) {
      embed.addFields({
        name: '🔒 Closed At',
        value: `<t:${Math.floor(new Date(ticketData.closedAt).getTime() / 1000)}:F>`,
        inline: true,
      });
    }

    // Add linked playertags if any
    if (ticketData.playertags && ticketData.playertags.length > 0) {
      embed.addFields({
        name: '🎮 Added Playertags',
        value: ticketData.playertags.map((tag) => `\`${tag}\``).join(', '),
        inline: false,
      });
    } else {
      embed.addFields({
        name: '🎮 Added Playertags',
        value: '_No player tags linked yet_',
        inline: false,
      });
    }

    const ticketButton = new ButtonBuilder()
      .setLabel(`${ticketData.isClosed === true ? 'Reopen' : 'Close'} Ticket`)
      .setCustomId(makeCustomId('b', 'ticket_openclose', guildId, { cooldown: 5, extra: [channelId] }))
      .setStyle(ButtonStyle.Primary);

    const ticketActionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(ticketButton);

    if (!ticketData.isClosed) {
      const appendButton = new ButtonBuilder()
        .setLabel('Append to Name')
        .setCustomId(makeCustomId('b', 'ticket_append', guildId, { cooldown: 5, extra: [channelId] }))
        .setStyle(ButtonStyle.Primary);
      ticketActionRow.addComponents(appendButton);
      const resendButton = new ButtonBuilder()
        .setLabel('Resend Playertag Button')
        .setCustomId(makeCustomId('b', 'ticket_resend_playertag_button', guildId, { cooldown: 5, extra: [channelId] }))
        .setStyle(ButtonStyle.Secondary);
      ticketActionRow.addComponents(resendButton);
    }
    embed.setTimestamp();
    embed.setFooter({ text: `Ticket Channel ID: ${channelId}` });

    await interaction.editReply({ embeds: [embed], components: [ticketActionRow] });
  },
};

export default command;
