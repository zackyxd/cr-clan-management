/**
 * Feature-based interaction router for clan settings
 * Pure dispatcher - all business logic is in handlers
 */

import { ButtonInteraction, MessageFlags, ModalSubmitInteraction, StringSelectMenuInteraction } from 'discord.js';
import type { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { buildClanSettingsView, getSelectMenuRowBuilder } from './config.js';
import { clanSettingsService } from './service.js';
import { ClanSettingsHandler } from './handlers/clanSettings.js';
import { EodStatsHandler } from './handlers/eodStats.js';
import { InvitesHandler } from './handlers/invites.js';
import { NudgesHandler } from './handlers/nudges.js';
import { ChannelsHandler } from './handlers/channels.js';
import { RacePingsHandler } from './handlers/racePings.js';
import { ClanLogsHandler } from './handlers/clanlogs.js';
import { StatsColorsHandler } from './handlers/statsColors.js';
import logger from '../../logger.js';

export class ClanSettingsInteractionRouter {
  /**
   * Route button interactions to appropriate handlers
   */
  static async handleButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, extra } = parsed;
    switch (action) {
      case 'clanSettings':
        await this.handleClanSettingsToggle(interaction, extra);
        break;

      case 'clanSettingsShowModal':
        await this.handleShowModal(interaction, extra);
        break;

      case 'clanSettingsAction':
        await this.handleClanSettingsAction(interaction, extra);
        break;

      default:
        await interaction.reply({
          content: 'Unknown clan settings action.',
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  /**
   * Show/display modal to user (when button clicked)
   */
  private static async handleShowModal(interaction: ButtonInteraction, extra: ParsedCustomId['extra']): Promise<void> {
    const cacheKey = extra[0];
    if (!cacheKey) {
      await interaction.reply({
        content: 'Missing cache key. Please try again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get cached settings data
    const settingsData = clanSettingsService.getCachedSettingsData(cacheKey);
    if (!settingsData) {
      await interaction.reply({
        content: 'Settings data not found. Please reselect the clan in the select menu, or run the command again.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { settingKey: action, clantag, clanName, guildId } = settingsData;

    // Check permissions
    const allowed = await checkPerms(interaction, 'button', 'either', {
      hideNoPerms: true,
      skipDefer: true,
    });
    if (!allowed) return;

    // Handle different modal types
    switch (action) {
      case 'clan_settings':
        await ClanSettingsHandler.showModal(interaction, settingsData);
        break;

      case 'race_nudge_channel_id':
        await ChannelsHandler.showModal(
          interaction,
          guildId,
          clantag,
          clanName,
          'race_nudge_channel_id',
          'Nudge Channel',
        );
        break;

      case 'nudge_settings':
        await NudgesHandler.showModal(interaction, settingsData);
        break;

      case 'ping_settings':
        await RacePingsHandler.showModal(interaction, settingsData);
        break;

      case 'clan_logs':
        await ClanLogsHandler.showModal(interaction, settingsData);
        break;

      case 'stats_colors':
        await StatsColorsHandler.showModal(interaction, settingsData);
        break;

      default:
        await interaction.reply({
          content: `Unknown modal type: ${action}`,
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  /**
   * Route modal submission interactions to appropriate handlers
   */
  static async handleModalSubmit(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action } = parsed;

    switch (action) {
      case 'clanSettings_clan_settings':
        await ClanSettingsHandler.handleModal(interaction);
        break;

      case 'clanSettings_race_nudge_channel_id':
        await ChannelsHandler.handleModal(interaction, 'race_nudge_channel_id');
        break;

      case 'clanSettings_nudge_settings':
        await NudgesHandler.handleModal(interaction);
        break;

      case 'clanSettings_race_ping_settings':
        await RacePingsHandler.handleModal(interaction);
        break;

      case 'clanSettings_clan_logs_settings':
        await ClanLogsHandler.handleModal(interaction);
        break;

      case 'clanSettings_stats_colors':
        await StatsColorsHandler.handleModal(interaction);
        break;

      default:
        await interaction.reply({
          content: 'Unknown clan settings modal.',
          flags: MessageFlags.Ephemeral,
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
          flags: MessageFlags.Ephemeral,
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
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Get cached settings data
      const settingsData = clanSettingsService.getCachedSettingsData(cacheKey);
      if (!settingsData) {
        await interaction.reply({
          content: 'Settings data not found. Please reselect the clan in the select menu, or run the command again.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { settingKey: featureName, guildId: _guildId } = settingsData;

      // Check permissions
      const allowed = await checkPerms(interaction, 'button', 'higher', {
        hideNoPerms: true,
        deferEphemeral: true,
      });
      if (!allowed) return;

      // Handle different actions

      switch (featureName) {
        case 'purge_invites':
          await InvitesHandler.purge(interaction, settingsData);
          break;

        default:
          await interaction.reply({
            content: `Unknown setting: ${featureName}`,
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      logger.error('Error in clan settings action:', error);
      await interaction.reply({
        content: 'An error occurred while handling the action.',
        flags: MessageFlags.Ephemeral,
      });
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
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Get cached settings data
      const settingsData = clanSettingsService.getCachedSettingsData(cacheKey);
      if (!settingsData) {
        await interaction.reply({
          content: 'Settings data not found. Please reselect the clan in the select menu, or run the command again.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { settingKey: featureName, guildId: _guildId2 } = settingsData;

      // Check permissions
      const allowed = await checkPerms(interaction, 'button', 'either', { hideNoPerms: true });
      if (!allowed) return;

      // Handle different setting types
      switch (featureName) {
        case 'nudge_enabled':
          await NudgesHandler.toggleNudgeEnabled(interaction, settingsData);
          break;

        case 'eod_stats_enabled':
          await EodStatsHandler.toggle(interaction, settingsData);
          break;

        case 'invites_enabled':
          await InvitesHandler.toggle(interaction, settingsData);
          break;

        default:
          await interaction.reply({
            content: `Unknown setting: ${featureName}`,
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      logger.error('Error in clan settings toggle:', error);
      await interaction.reply({
        content: 'An error occurred while updating the setting.',
        flags: MessageFlags.Ephemeral,
      });
    }
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
          flags: MessageFlags.Ephemeral,
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
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { clantag, clanName } = clanData;
      if (!clantag || !clanName) {
        await interaction.followUp({
          content: '❌ Missing clan information. Please try again.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Get the guild ID from the interaction
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.followUp({
          content: '❌ This command must be used in a server.',
          flags: MessageFlags.Ephemeral,
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
      logger.error('Error in clan select menu:', error);
      await interaction.followUp({
        content: '❌ An error occurred while loading clan settings.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
