import {
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalSubmitInteraction,
  EmbedBuilder,
} from 'discord.js';
import { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { makeCustomId } from '../../utils/customId.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { parseInviteLink } from './utils.js';
import { processInviteLinkUpdate } from './messageManager.js';
import logger from '../../logger.js';

export class ClanInvitesInteractionRouter {
  /**
   * Handle "Update Link" button - opens modal for user to paste invite link
   */
  static async handleClanInviteRefresh(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    const { guildId } = parsed;

    // Show modal for user to input invite link
    const modal = new ModalBuilder()
      .setCustomId(makeCustomId('m', 'clanInviteUpdate', guildId, { cooldown: 5 }))
      .setTitle('Update Clan Invite Link')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('input')
            .setLabel('Paste your clan invite link here')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://link.clashroyale.com/invite/clan/...')
            .setRequired(true),
        ),
      );

    await interaction.showModal(modal);
  }

  static async handleButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action } = parsed;
    if (action === 'clanInviteRefresh') {
      await this.handleClanInviteRefresh(interaction, parsed);
    } else {
      await interaction.reply({
        content: 'Unknown action for clan invites.',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle modal submissions for clan invites
   */
  static async handleModal(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, guildId } = parsed;

    if (action === 'clanInviteUpdate') {
      await this.handleUpdateInviteModal(interaction, guildId);
    } else {
      await interaction.reply({
        content: 'Unknown modal action for clan invites.',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle the update invite modal submission
   */
  private static async handleUpdateInviteModal(interaction: ModalSubmitInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const inviteLink = interaction.fields.getTextInputValue('input');

    const parsedLink = parseInviteLink(inviteLink);
    if (!parsedLink) {
      const embed = new EmbedBuilder()
        .setDescription('❌ Invalid invite link format. Please provide a valid Clash Royale invite link.')
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    try {
      // Use shared logic from messageManager
      const result = await processInviteLinkUpdate(
        guildId,
        parsedLink.clantag,
        parsedLink.fullLink,
        interaction.user.id,
        interaction.client,
      );

      await interaction.editReply({ embeds: [result.embed] });
    } catch (err) {
      logger.error('Unexpected error in invite update modal:', err);
      const embed = new EmbedBuilder()
        .setDescription(`❌ An unexpected error occurred. Please contact support.`)
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
    }
  }
}
