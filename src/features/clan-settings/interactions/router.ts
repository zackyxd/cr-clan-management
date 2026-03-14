/**
 * Feature-based interaction router for clan settings
 * Handles all clan settings interactions in one place
 */

import {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  RoleSelectMenuBuilder,
  LabelBuilder,
  NewsChannel,
  TextChannel,
} from 'discord.js';
import type { ParsedCustomId } from '../../../types/ParsedCustomId.js';
import { parseCustomId, makeCustomId } from '../../../utils/customId.js';
import { checkPerms } from '../../../utils/checkPermissions.js';
import { EmbedColor } from '../../../types/EmbedUtil.js';
import { buildClanSettingsView, getSelectMenuRowBuilder } from '../../../config/clanSettingsConfig.js';
import { clanSettingsService } from '../service.js';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import { clanInviteService } from '../../clan-invites/service.js';

export class ClanSettingsInteractionRouter {
  /**
   * Route button interactions to appropriate handlers
   */
  static async handleButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, extra } = parsed;
    console.log(action, extra);
    switch (action) {
      case 'clanSettings':
        await this.handleClanSettingsToggle(interaction, extra);
        break;

      case 'clanSettingsOpenModal':
        await this.handleOpenModal(interaction, extra);
        break;

      case 'clanSettingsAction':
        await this.handleClanSettingsAction(interaction, extra);
        break;

      default:
        await interaction.reply({
          content: 'Unknown clan settings action.',
          ephemeral: true,
        });
    }
  }

  /**
   * Route modal interactions to appropriate handlers
   */
  static async handleModal(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action } = parsed;

    switch (action) {
      case 'clanSettings_abbreviation':
        await this.handleAbbreviationModal(interaction);
        break;

      case 'clanSettings_clan_role_id':
        await this.handleClanRoleModal(interaction);
        break;

      default:
        await interaction.reply({
          content: 'Unknown clan settings modal.',
          ephemeral: true,
        });
    }
  }

  /**
   * Route select menu interactions to appropriate handlers
   */
  static async handleSelectMenu(interaction: StringSelectMenuInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action } = parsed;

    switch (action) {
      case 'clanSettings':
        await this.handleClanSelectMenu(interaction);
        break;

      default:
        await interaction.reply({
          content: 'Unknown clan settings select menu.',
          ephemeral: true,
        });
    }
  }

  // Private handlers for each specific interaction

  /**
   * Handle clan setting action buttons (Purge invites)
   */
  private static async handleClanSettingsAction(
    interaction: ButtonInteraction,
    extra: ParsedCustomId['extra'],
  ): Promise<void> {
    try {
      const cacheKey = extra[0];
      if (!cacheKey) {
        await interaction.reply({
          content: 'Missing cache key. Please try again.',
          ephemeral: true,
        });
        return;
      }

      // Get cached settings data
      const settingsData = clanSettingsService.getCachedSettingsData(cacheKey);
      if (!settingsData) {
        await interaction.reply({
          content: 'Settings data not found. Please reselect the clan in the select menu, or run the command again.',
          ephemeral: true,
        });
        return;
      }

      const { settingKey: featureName, clantag, clanName, guildId } = settingsData;

      // Check permissions
      const allowed = await checkPerms(interaction, guildId, 'button', 'higher', {
        hideNoPerms: true,
        deferEphemeral: true,
      });
      if (!allowed) return;

      // Handle different actions

      switch (featureName) {
        case 'purge_invites':
          await this.handlePurgeInvitesAction(interaction, guildId, clantag, clanName);
          break;

        default:
          await interaction.reply({
            content: `Unknown setting: ${featureName}`,
            ephemeral: true,
          });
      }
    } catch (error) {
      console.error('Error in clan settings action:', error);
      await interaction.reply({
        content: 'An error occurred while handling the action.',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle purge invites action - this will delete all existing invites for the clan and optionally send a log message
   * Only higher-staff roles can use this button.
   */
  private static async handlePurgeInvitesAction(
    interaction: ButtonInteraction,
    guildId: string,
    clantag: string,
    clanName: string,
  ) {
    interface ActiveInviteWithMessages {
      invite_link_id: number;
      guild_id: string;
      clantag: string;
      clan_name: string;
      invite_link: string;
      expires_at: Date;
      messages: Array<{
        id: number;
        message_id: string;
        channel_id: string;
        source_type: string;
        sent_by_id: string;
      }>;
    }

    interface FailedMessage {
      messageId: string;
      channelId: string;
      error?: string;
    }

    const result = await pool.query<ActiveInviteWithMessages>(
      `
      SELECT 
        cil.id as invite_link_id,
        cil.guild_id,
        cil.clantag,
        c.clan_name,
        cil.invite_link,
        cil.expires_at,
        array_agg(
          json_build_object(
            'id', ilm.id,
            'message_id', ilm.message_id,
            'channel_id', ilm.channel_id,
            'source_type', ilm.source_type,
            'sent_by_id', ilm.sent_by_id
          )
        ) AS messages
      FROM clan_invites_links cil
      INNER JOIN invite_link_messages ilm ON ilm.invite_link_id = cil.id
      LEFT JOIN clans c ON c.guild_id = cil.guild_id AND c.clantag = cil.clantag
      WHERE cil.guild_id = $1 
        AND cil.clantag = $2
        AND cil.expires_at > NOW() 
        AND cil.is_expired = FALSE
      GROUP BY cil.id, cil.guild_id, cil.clantag, c.clan_name, cil.invite_link, cil.expires_at
    `,
      [guildId, clantag],
    );

    let deletedCount = 0;
    const failedMessages: FailedMessage[] = [];
    const unknownChannel = [];

    for (const inviteData of result.rows) {
      const validMessages = inviteData.messages?.filter((msg) => msg.message_id && msg.channel_id) || [];

      for (const msg of validMessages) {
        try {
          const channel = await interaction.client.channels.fetch(msg.channel_id);
          if (!channel?.isTextBased() || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
            failedMessages.push({
              messageId: msg.message_id,
              channelId: msg.channel_id,
              error: 'Channel not accessible',
            });
            continue;
          }

          const message = await channel.messages.fetch(msg.message_id);
          await message.delete();
          deletedCount++;
          logger.info(`Deleted message ${msg.message_id} in channel ${msg.channel_id}`);
        } catch (deleteErr: unknown) {
          const error = deleteErr as { code?: number; message?: string };

          if (error.code === 10008) {
            // Already deleted, count as success
            deletedCount++;
          } else if (error.code === 10003) {
            unknownChannel.push({
              messageId: msg.message_id,
              channelId: msg.channel_id,
              error: 'Cannot see channel',
            });
          } else {
            failedMessages.push({
              messageId: msg.message_id,
              channelId: msg.channel_id,
              error: error.message || 'Unknown error',
            });
          }
        }
      }
    }

    // Build reply with failed messages
    let replyContent = `✅ Deleted ${deletedCount} invite message(s) for ${clanName}.`;

    if (unknownChannel.length > 0) {
      replyContent += `\n\n⚠️ Could not delete ${unknownChannel.length} message(s) due to missing channel access.`;
    }
    if (failedMessages.length > 0) {
      replyContent += `\n\n⚠️ Failed to delete ${failedMessages.length} message(s):`;
      for (const failed of failedMessages) {
        replyContent += `\n-# https://discord.com/channels/${guildId}/${failed.channelId}/${failed.messageId} (${failed.error})`;
      }
    }

    const message = await interaction.followUp({
      content: replyContent,
      ephemeral: true,
    });
    if (message) {
      await clanInviteService.sendLog(
        interaction.client,
        guildId,
        '🧹 Clan Invites Purged',
        `**Purged by:** <@${interaction.user.id}>\n**Clan:** ${clanName}\n**Tag:** ${clantag}\n**Deleted Links:** ${deletedCount}\n**Unknown Channel Access:** ${unknownChannel.length}\n**Failed Deletions:** ${failedMessages.length}`,
      );
    }
  }

  /**
   * Handle clan settings toggle buttons (family_clan, nudge_enabled, invites_enabled)
   */
  private static async handleClanSettingsToggle(
    interaction: ButtonInteraction,
    extra: ParsedCustomId['extra'],
  ): Promise<void> {
    try {
      const cacheKey = extra[0];
      if (!cacheKey) {
        await interaction.reply({
          content: 'Missing cache key. Please try again.',
          ephemeral: true,
        });
        return;
      }

      // Get cached settings data
      const settingsData = clanSettingsService.getCachedSettingsData(cacheKey);
      if (!settingsData) {
        await interaction.reply({
          content: 'Settings data not found. Please reselect the clan in the select menu, or run the command again.',
          ephemeral: true,
        });
        return;
      }

      const { settingKey: featureName, clantag, clanName, guildId } = settingsData;

      // Check permissions
      const allowed = await checkPerms(interaction, guildId, 'button', 'either', { hideNoPerms: true });
      if (!allowed) return;

      // Handle different setting types
      switch (featureName) {
        case 'family_clan':
          await this.handleFamilyClanToggle(interaction, guildId, clantag, clanName);
          break;

        case 'nudge_enabled':
          await this.handleNudgeEnabledToggle(interaction, guildId, clantag, clanName);
          break;

        case 'invites_enabled':
          await this.handleInvitesEnabledToggle(interaction, guildId, clantag, clanName);
          break;

        default:
          await interaction.reply({
            content: `Unknown setting: ${featureName}`,
            ephemeral: true,
          });
      }
    } catch (error) {
      console.error('Error in clan settings toggle:', error);
      await interaction.reply({
        content: 'An error occurred while updating the setting.',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle family clan toggle
   */
  private static async handleFamilyClanToggle(
    interaction: ButtonInteraction,
    guildId: string,
    clantag: string,
    clanName: string,
  ): Promise<void> {
    const result = await clanSettingsService.toggleFamilyClan(guildId, clantag);

    if (!result.success) {
      const embed = new EmbedBuilder()
        .setDescription(result.error || 'Failed to toggle family clan setting')
        .setColor(EmbedColor.FAIL);
      await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    await this.updateClanSettingsView(interaction, guildId, clantag, clanName);
  }

  /**
   * Handle nudge enabled toggle
   */
  private static async handleNudgeEnabledToggle(
    interaction: ButtonInteraction,
    guildId: string,
    clantag: string,
    clanName: string,
  ): Promise<void> {
    const result = await clanSettingsService.toggleNudgeEnabled(guildId, clantag);

    if (!result.success) {
      await interaction.reply({
        content: result.error || 'Failed to toggle nudge setting',
        ephemeral: true,
      });
      return;
    }

    await this.updateClanSettingsView(interaction, guildId, clantag, clanName);
  }

  /**
   * Handle invites enabled toggle
   */
  private static async handleInvitesEnabledToggle(
    interaction: ButtonInteraction,
    guildId: string,
    clantag: string,
    clanName: string,
  ): Promise<void> {
    const result = await clanSettingsService.toggleInvitesEnabled(guildId, clantag);

    if (!result.success) {
      await interaction.reply({
        content: result.error || 'Failed to toggle invite setting',
        ephemeral: true,
      });
      return;
    }

    // Handle invite message update if needed
    if (result.inviteUpdateNeeded && result.inviteSettings) {
      try {
        await clanSettingsService.handleInviteMessageUpdate(result.inviteSettings, guildId, interaction.client);
      } catch {
        // Error updating invite message
        const embed = new EmbedBuilder()
          .setDescription(
            'Setting updated, but could not update invite message. Please check the invite channel setup.',
          )
          .setColor(EmbedColor.WARNING);
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    }

    // Show warning message if invite settings aren't configured
    if (result.warning) {
      const embed = new EmbedBuilder().setDescription(result.warning).setColor(EmbedColor.SUCCESS);
      await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    await this.updateClanSettingsView(interaction, guildId, clantag, clanName);
  }

  /**
   * Update the clan settings view with new data
   */
  private static async updateClanSettingsView(
    interaction: ButtonInteraction,
    guildId: string,
    clantag: string,
    clanName: string,
  ): Promise<void> {
    try {
      // Find the select menu row in the current message
      const selectMenuRowBuilder = getSelectMenuRowBuilder(interaction.message.components);

      // Build new button rows with updated settings
      const { embed, components: newButtonRows } = await buildClanSettingsView(
        guildId,
        clanName,
        clantag,
        interaction.user.id,
      );

      // Replace all components with the new ones
      await interaction.editReply({
        embeds: [embed],
        components: selectMenuRowBuilder
          ? [...newButtonRows, selectMenuRowBuilder] // ✅ select menu goes last
          : newButtonRows,
      });
    } catch (error) {
      console.error('[updateClanSettingsView] Failed to update view:', error);
      // Silently fail - Discord API might be temporarily unavailable
    }
  }

  /**
   * Handle abbreviation modal submission
   */
  private static async handleAbbreviationModal(interaction: ModalSubmitInteraction): Promise<void> {
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

    // await interaction.deferReply({ ephemeral: true });

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
    const result = await clanSettingsService.updateAbbreviation(guildId, clantag, abbreviation);

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
      console.error('[handleAbbreviationModal] Failed to edit message:', error);
      // Continue anyway to send confirmation
    }

    await interaction.followUp({
      content: '✅ Abbreviation updated successfully!',
      flags: MessageFlags.Ephemeral,
    });
  }

  /**
   * Handle clan role modal submission
   */
  private static async handleClanRoleModal(interaction: ModalSubmitInteraction): Promise<void> {
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

    // await interaction.deferReply({ ephemeral: true });

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
    const result = await clanSettingsService.updateClanRole(guildId, clantag, role.id);

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
      console.error('[handleClanRoleModal] Failed to edit message:', error);
      // Continue anyway to send confirmation
    }

    await interaction.followUp({
      content: '✅ Clan role updated successfully!',
      flags: MessageFlags.Ephemeral,
    });
  }

  /**
   * Handle opening modals for clan settings (abbreviation, clan role, etc.)
   */
  private static async handleOpenModal(interaction: ButtonInteraction, extra: ParsedCustomId['extra']): Promise<void> {
    const cacheKey = extra[0];
    if (!cacheKey) {
      await interaction.reply({
        content: 'Missing cache key. Please try again.',
        ephemeral: true,
      });
      return;
    }

    // Get cached settings data
    const settingsData = clanSettingsService.getCachedSettingsData(cacheKey);
    if (!settingsData) {
      await interaction.reply({
        content: 'Settings data not found. Please reselect the clan in the select menu, or run the command again.',
        ephemeral: true,
      });
      return;
    }

    const { settingKey: action, clantag, clanName, guildId } = settingsData;

    // Check permissions
    const allowed = await checkPerms(interaction, guildId, 'button', 'higher', {
      hideNoPerms: true,
      skipDefer: true,
    });
    if (!allowed) return;

    // Handle different modal types
    switch (action) {
      case 'abbreviation':
        await this.showAbbreviationModal(interaction, guildId, clantag);
        break;

      case 'clan_role_id':
        await this.showClanRoleModal(interaction, guildId, clantag, clanName);
        break;

      default:
        await interaction.reply({
          content: `Unknown modal type: ${action}`,
          ephemeral: true,
        });
    }
  }

  /**
   * Show abbreviation modal
   */
  private static async showAbbreviationModal(
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
   * Show clan role modal
   */
  private static async showClanRoleModal(
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
   * Handle clan selection from the select menu
   */
  private static async handleClanSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
    try {
      await interaction.deferUpdate();

      // Parse the selected clan data from the select menu value
      const selectedValue = interaction.values[0];
      if (!selectedValue) {
        await interaction.followUp({
          content: '❌ No clan selected. Please try again.',
          ephemeral: true,
        });
        return;
      }

      // The value contains JSON with clantag and clanName
      let clanData;
      try {
        clanData = JSON.parse(selectedValue);
      } catch {
        await interaction.followUp({
          content: '❌ Invalid clan data. Please try again.',
          ephemeral: true,
        });
        return;
      }

      const { clantag, clanName } = clanData;
      if (!clantag || !clanName) {
        await interaction.followUp({
          content: '❌ Missing clan information. Please try again.',
          ephemeral: true,
        });
        return;
      }

      // Get the guild ID from the interaction
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.followUp({
          content: '❌ This command must be used in a server.',
          ephemeral: true,
        });
        return;
      }

      // Build the clan settings view
      const { embed, components: newButtonRows } = await buildClanSettingsView(
        guildId,
        clanName,
        clantag,
        interaction.user.id,
      );

      // Get the current select menu to keep it in the updated message
      const selectMenuRowBuilder = getSelectMenuRowBuilder(interaction.message.components);

      // Update the message with the selected clan's settings
      await interaction.editReply({
        embeds: [embed],
        components: selectMenuRowBuilder
          ? [...newButtonRows, selectMenuRowBuilder] // ✅ select menu goes last
          : newButtonRows,
      });
    } catch (error) {
      console.error('Error in clan select menu:', error);
      await interaction.followUp({
        content: '❌ An error occurred while loading clan settings.',
        ephemeral: true,
      });
    }
  }
}
