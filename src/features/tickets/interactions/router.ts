import {
  ActionRowBuilder,
  ButtonInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { ParsedCustomId } from '../../../types/ParsedCustomId.js';
import { checkPerms } from '../../../utils/checkPermissions.js';
import { buildFeatureEmbedAndComponents } from '../../../config/serverSettingsBuilder.js';
import { CR_API } from '../../../api/CR_API.js';
import logger from '../../../logger.js';
import { ticketService } from '../service.js';
import { makeCustomId } from '../../../utils/customId.js';

export class TicketInteractionRouter {
  /**
   * Handle ticket button interactions
   */
  static async handleButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, guildId } = parsed;

    // Check permissions
    const allowed = await checkPerms(interaction, guildId, 'button', 'higher', {
      hideNoPerms: true,
      skipDefer: true, // Modal needs skipDefer
    });
    if (!allowed) return;

    switch (action) {
      case 'ticketPlayertagsOpenModal':
        await this.showPlayertagsModal(interaction, guildId);
        break;

      default:
        await interaction.reply({
          content: 'Unknown ticket action.',
          ephemeral: true,
        });
    }
  }

  /**
   * Handle ticket modal interactions
   */
  static async handleModal(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, guildId } = parsed;

    // Check permissions
    const allowed = await checkPerms(interaction, guildId, 'modal', 'higher', { skipDefer: true });
    if (!allowed) return;

    await interaction.deferReply();

    switch (action) {
      case 'ticketPlayertagsOpenModal':
        await this.handleModalSubmit(interaction, guildId);
        break;

      case 'opened_identifier':
      case 'closed_identifier':
        await this.handleIdentifierModal(interaction, guildId, action);
        break;

      default:
        await interaction.editReply({
          content: 'Unknown ticket modal action.',
        });
    }
  }

  /**
   * Handle select menu interactions
   */
  static async handleSelectMenu(_interaction: StringSelectMenuInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action } = parsed;
    logger.info('Ticket select menu action:', action);
    // No select menus for tickets yet
  }

  /**
   * Show modal for entering playertags
   */
  private static async showPlayertagsModal(interaction: ButtonInteraction, guildId: string): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId(makeCustomId('m', 'ticketPlayertagsOpenModal', guildId))
      .setTitle('Enter Clash Royale Playertags')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('input')
            .setLabel('Separate multiple tags by spaces')
            .setPlaceholder('#ABC123 #DEF456 #GHI789')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
        )
      );

    await interaction.showModal(modal);
  }

  /**
   * Handle ticket_channel modal submission (adding playertags)
   */
  private static async handleModalSubmit(interaction: ModalSubmitInteraction, guildId: string): Promise<void> {
    const inputTags = interaction.fields.getTextInputValue('input').toUpperCase().split(' ');
    // Remove empty strings and normalize
    const normalizedTags = inputTags.map((tag) => CR_API.normalizeTag(tag)).filter(Boolean);

    if (normalizedTags.length === 0) {
      await interaction.editReply({ content: 'No valid playertags provided.' });
      return;
    }

    if (!interaction.channelId) {
      await interaction.editReply({ content: 'Could not determine channel ID.' });
      return;
    }

    // Add playertags via service
    const result = await ticketService.addPlayertags({
      guildId,
      channelId: interaction.channelId,
      playertags: normalizedTags,
      userId: interaction.user.id,
    });

    if (!result.success) {
      await interaction.editReply({
        content: result.error || 'Failed to add playertags.',
      });
      return;
    }

    // Send response with embeds
    if (result.embeds && result.embeds.length > 0) {
      const allEmbeds = [...result.embeds, ...(result.invalidEmbeds || [])];
      await interaction.editReply({
        content: `**These are the entered playertags by <@${interaction.user.id}>**`,
        embeds: allEmbeds,
      });
    } else if (result.invalidEmbeds && result.invalidEmbeds.length > 0) {
      await interaction.editReply({
        content: 'Invalid playertags:',
        embeds: result.invalidEmbeds,
      });
    } else {
      await interaction.editReply({
        content: 'All playertags were already added to this ticket.',
      });
    }
  }

  /**
   * Handle identifier modal (opened_identifier or closed_identifier)
   */
  private static async handleIdentifierModal(
    interaction: ModalSubmitInteraction,
    guildId: string,
    action: 'opened_identifier' | 'closed_identifier'
  ): Promise<void> {
    const messageId = interaction.message?.id;
    if (!messageId) {
      await interaction.reply({
        content: 'Could not find original message.',
        ephemeral: true,
      });
      return;
    }

    const message = await interaction.channel?.messages.fetch(messageId);
    if (!message) {
      await interaction.reply({
        content: 'Could not find original message.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const newValue = interaction.fields.getTextInputValue('input');

    // Update via service
    const result = await ticketService.updateIdentifier({
      guildId,
      settingKey: action,
      value: newValue,
    });

    if (!result.success) {
      await interaction.editReply({
        content: result.error || 'Failed to update identifier.',
      });
      return;
    }

    // Update the UI
    const { embed, components } = await buildFeatureEmbedAndComponents(guildId, interaction.user.id, 'tickets');
    await message.edit({ embeds: [embed], components });
    await interaction.editReply({ content: '✅ Updated successfully' });
  }
}
