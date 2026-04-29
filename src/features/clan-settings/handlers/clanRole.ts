/**
 * Clan Role Handler
 * 
 * Handles clan role modal (show + submission)
 */

import {
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  RoleSelectMenuBuilder,
  LabelBuilder,
  MessageFlags,
} from 'discord.js';
import { makeCustomId, parseCustomId } from '../../../utils/customId.js';
import { checkPerms } from '../../../utils/checkPermissions.js';
import { clanSettingsService } from '../service.js';
import { buildClanSettingsView, getSelectMenuRowBuilder } from '../config.js';
import logger from '../../../logger.js';

export class ClanRoleHandler {
  /**
   * Show clan role modal
   */
  static async showModal(
    interaction: ButtonInteraction,
    guildId: string,
    clantag: string,
    clanName: string,
  ): Promise<void> {
    const modal = new ModalBuilder()
      .setTitle('Set Clan Role')
      .setCustomId(makeCustomId('m', 'clanSettings_clan_role_id', guildId, { extra: [clantag, clanName] }))
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Role Select')
          .setRoleSelectMenuComponent(new RoleSelectMenuBuilder().setCustomId('input').setMaxValues(1)),
      );

    await interaction.showModal(modal);
  }

  /**
   * Handle clan role modal submission
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

    // Get the role ID from the modal input
    const roleSelected = interaction.fields.getSelectedRoles('input')?.first();
    if (!roleSelected || !roleSelected.id) {
      await interaction.followUp({ content: '❌ Please select a valid role.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Validate that the role exists in the guild
    const role = await interaction.guild?.roles.fetch(roleSelected.id).catch(() => null);
    if (!role) {
      await interaction.followUp({
        content: '❌ Could not find that role in this server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check permissions
    const allowed = await checkPerms(interaction, guildId, 'modal', 'either', { hideNoPerms: true });
    if (!allowed) return;

    // Update clan role using service
    const result = await clanSettingsService.updateClanRole(
      interaction.client,
      guildId,
      clantag,
      role.id,
      interaction.user.id,
    );

    if (!result.success) {
      await interaction.followUp({
        content: result.error || '❌ Failed to update clan role.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get clan name and update the view
    const clanName = await clanSettingsService.getClanName(guildId, clantag);

    if (!interaction.message) {
      await interaction.followUp({
        content: '✅ Clan role updated successfully!',
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
      logger.error('[ClanRole] Failed to edit message:', error);
      // Continue anyway to send confirmation
    }

    logger.info(
      `[ClanRole] ${interaction.user.tag} updated clan role to <@&${role.id}> for ${clantag} in guild ${guildId}`,
    );

    await interaction.followUp({
      content: '✅ Clan role updated successfully!',
      flags: MessageFlags.Ephemeral,
    });
  }
}
