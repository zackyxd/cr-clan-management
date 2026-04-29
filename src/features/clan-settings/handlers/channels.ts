/**
 * Channels Handler
 * 
 * Handles channel selection modals for:
 * - staff_channel_id
 * - race_nudge_channel_id
 */

import {
  ButtonInteraction,
  ModalSubmitInteraction,
  ModalBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  LabelBuilder,
  MessageFlags,
} from 'discord.js';
import { makeCustomId, parseCustomId } from '../../../utils/customId.js';
import { checkPerms } from '../../../utils/checkPermissions.js';
import { clanSettingsService } from '../service.js';
import { buildClanSettingsView, getSelectMenuRowBuilder } from '../config.js';
import logger from '../../../logger.js';

export class ChannelsHandler {
  /**
   * Show channel select modal
   */
  static async showModal(
    interaction: ButtonInteraction,
    guildId: string,
    clantag: string,
    clanName: string,
    settingKey: 'race_nudge_channel_id' | 'staff_channel_id',
    title: string,
  ): Promise<void> {
    const modal = new ModalBuilder()
      .setTitle(`Set ${title}`)
      .setCustomId(makeCustomId('m', `clanSettings_${settingKey}`, guildId, { extra: [clantag, clanName] }))
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Channel Select')
          .setChannelSelectMenuComponent(
            new ChannelSelectMenuBuilder()
              .setCustomId('input')
              .setMaxValues(1)
              .setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement]),
          ),
      );

    await interaction.showModal(modal);
  }

  /**
   * Handle channel modal submission
   */
  static async handleModal(
    interaction: ModalSubmitInteraction,
    settingKey: 'race_nudge_channel_id' | 'staff_channel_id',
  ): Promise<void> {
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

    // Get the channel ID from the modal input
    const channelSelected = interaction.fields.getSelectedChannels('input')?.first();
    if (!channelSelected || !channelSelected.id) {
      await interaction.followUp({ content: '❌ Please select a valid channel.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Validate that the channel exists and is text-based
    const channel = await interaction.guild?.channels.fetch(channelSelected.id).catch(() => null);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
      await interaction.followUp({
        content: '❌ Could not find that channel or it is not a text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check permissions
    const allowed = await checkPerms(interaction, guildId, 'modal', 'either', { hideNoPerms: true });
    if (!allowed) return;

    // Update channel using service
    const result = await clanSettingsService.updateClanSetting(
      interaction.client,
      guildId,
      clantag,
      settingKey,
      channel.id,
      interaction.user.id,
    );

    if (!result.success) {
      await interaction.followUp({
        content: result.error || `❌ Failed to update ${settingKey}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get clan name and update the view
    const clanName = await clanSettingsService.getClanName(guildId, clantag);

    if (!interaction.message) {
      await interaction.followUp({
        content: '✅ Channel updated successfully!',
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
      logger.error(`[Channels] Failed to edit message:`, error);
      // Continue anyway to send confirmation
    }

    const settingLabel = settingKey === 'race_nudge_channel_id' ? 'nudge channel' : 'staff channel';
    logger.info(
      `[Channels] ${interaction.user.tag} updated ${settingLabel} to <#${channel.id}> for ${clantag} in guild ${guildId}`,
    );

    await interaction.followUp({
      content: '✅ Channel updated successfully!',
      flags: MessageFlags.Ephemeral,
    });
  }
}
