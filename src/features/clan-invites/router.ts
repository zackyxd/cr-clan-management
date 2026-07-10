import {
  ButtonInteraction,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { makeCustomId } from '../../utils/customId.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { parseInviteLink } from './utils.js';
import { processInviteLinkUpdate } from './messageManager.js';
import logger from '../../logger.js';
import { checkPerms } from '../../utils/checkPermissions.js';

export class ClanInvitesInteractionRouter {
  /**
   * Handle "Update Link" button - opens modal for user to paste invite link
   */
  static async handleClanInviteRefresh(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    const { guildId } = parsed;
    const allowed = await checkPerms(interaction, 'button', 'either', { hideNoPerms: true, skipDefer: true });
    if (!allowed) return;
    // Show modal for user to input invite link
    const modal = new ModalBuilder()
      .setCustomId(makeCustomId('m', 'clanInviteUpdate', guildId, { cooldown: 5 }))
      .setTitle('Update Clan Invite Link')
      .addLabelComponents(
        new LabelBuilder().setLabel('Paste your clan invite link here').setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('input')
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
        flags: MessageFlags.Ephemeral,
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
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Handle the update invite modal submission
   */
  private static async handleUpdateInviteModal(interaction: ModalSubmitInteraction, guildId: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
