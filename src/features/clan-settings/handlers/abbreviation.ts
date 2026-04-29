/**
 * Abbreviation Handler
 * 
 * Handles clan abbreviation modal (show + submission)
 */

import {
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  MessageFlags,
} from 'discord.js';
import { makeCustomId, parseCustomId } from '../../../utils/customId.js';
import { checkPerms } from '../../../utils/checkPermissions.js';
import { clanSettingsService } from '../service.js';
import { buildClanSettingsView, getSelectMenuRowBuilder } from '../config.js';
import logger from '../../../logger.js';

export class AbbreviationHandler {
  /**
   * Show abbreviation modal
   */
  static async showModal(
    interaction: ButtonInteraction,
    guildId: string,
    clantag: string,
  ): Promise<void> {
    const modal = new ModalBuilder()
      .setTitle('Change Abbreviation')
      .setCustomId(makeCustomId('m', 'clanSettings_abbreviation', guildId, { extra: [clantag] }))
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Select new abbreviation')
          .setDescription('1-10 characters')
          .setTextInputComponent(
            new TextInputBuilder().setCustomId('input').setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(10),
          ),
      );

    await interaction.showModal(modal);
  }

  /**
   * Handle abbreviation modal submission
   */
  static async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCustomId(interaction.customId);
    const { guildId, extra } = parsed;
    const clantag = extra[0];

    if (!clantag) {
      await interaction.reply({
        content: 'Missing clan tag. Please try again.',
        ephemeral: true,
      });
      return;
    }

    // Get abbreviation from modal input
    const abbreviation = interaction.fields.getTextInputValue('input')?.trim();

    if (!abbreviation) {
      await interaction.followUp({
        content: '❌ Please provide a valid abbreviation.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check permissions
    const allowed = await checkPerms(interaction, guildId, 'modal', 'either', { hideNoPerms: true });
    if (!allowed) return;

    // Update abbreviation using service
    const result = await clanSettingsService.updateAbbreviation(
      interaction.client,
      guildId,
      clantag,
      abbreviation,
      interaction.user.id,
    );

    if (!result.success) {
      await interaction.followUp({
        content: result.error || '❌ Failed to update abbreviation.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get clan name and update the view
    const clanName = await clanSettingsService.getClanName(guildId, clantag);

    if (!interaction.message) {
      await interaction.followUp({
        content: '✅ Abbreviation updated successfully!',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Find the select menu row in the current message
    const selectMenuRowBuilder = getSelectMenuRowBuilder(interaction.message.components);

    // Build new button rows with updated settings
    const { embed, components: newButtonRows } = await buildClanSettingsView(
      guildId,
      clanName,
      clantag,
      interaction.user.id,
    );

    // Update the original message
    try {
      await interaction.message.edit({
        embeds: [embed],
        components: selectMenuRowBuilder ? [...newButtonRows, selectMenuRowBuilder] : newButtonRows,
      });
    } catch (error) {
      logger.error('[Abbreviation] Failed to edit message:', error);
      // Continue anyway to send confirmation
    }

    logger.info(
      `[Abbreviation] ${interaction.user.tag} updated abbreviation to "${abbreviation}" for ${clantag} in guild ${guildId}`,
    );

    await interaction.followUp({
      content: '✅ Abbreviation updated successfully!',
      flags: MessageFlags.Ephemeral,
    });
  }
}
