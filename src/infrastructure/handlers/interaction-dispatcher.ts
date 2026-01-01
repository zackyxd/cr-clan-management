/**
 * Central Interaction Dispatcher
 * Routes Discord interactions to appropriate feature handlers
 */

import { Interaction, ButtonInteraction, ModalSubmitInteraction, StringSelectMenuInteraction } from 'discord.js';
import { parseCustomId } from '../../utils/customId.js';
import type { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { MemberChannelInteractionRouter } from '../../features/member-channels/interactions/router.js';
import { ClanSettingsInteractionRouter } from '../../features/clan-settings/interactions/router.js';
import { ServerSettingsInteractionRouter } from '../../features/server-settings/interactions/router.js';
import logger from '../../logger.js';

// Define router interface
interface FeatureRouter {
  handleButton?: (interaction: ButtonInteraction, parsed: ParsedCustomId) => Promise<void>;
  handleModal?: (interaction: ModalSubmitInteraction, parsed: ParsedCustomId) => Promise<void>;
  handleSelectMenu?: (interaction: StringSelectMenuInteraction, parsed: ParsedCustomId) => Promise<void>;
}

export class InteractionDispatcher {
  /**
   * Feature routing map
   * Maps action prefixes to their respective router classes
   */
  private static featureRouters = new Map<string, FeatureRouter>([
    // Member Channel actions
    ['member_channel', MemberChannelInteractionRouter],
    ['create_member_channel', MemberChannelInteractionRouter], // Add this for the command modal
    ['open_modal_create_member_channel', MemberChannelInteractionRouter],
    ['any_account_count_modal', MemberChannelInteractionRouter],
    ['member_channel_select', MemberChannelInteractionRouter],

    // Clan Settings actions
    ['clanSettings', ClanSettingsInteractionRouter],
    ['clanSettingsOpenModal', ClanSettingsInteractionRouter], // For opening clan settings modals
    ['abbreviation', ClanSettingsInteractionRouter], // For abbreviation modal
    ['clan_role_id', ClanSettingsInteractionRouter], // For clan role modal

    // Server Settings actions
    ['serverSettings', ServerSettingsInteractionRouter],
    ['serverSettingsReturn', ServerSettingsInteractionRouter], // For "return" type actions
    ['serverSettingToggle', ServerSettingsInteractionRouter], // For toggle buttons
    ['serverSettingToggleFeature', ServerSettingsInteractionRouter], // For feature toggle buttons
    ['serverSettingOpenModal', ServerSettingsInteractionRouter], // For modal buttons (unless it conflicts with other features)
    ['serverSettingModal', ServerSettingsInteractionRouter], // For modal submissions
    ['serverSettingSwap', ServerSettingsInteractionRouter], // For swap buttons
    ['serverSettingAction', ServerSettingsInteractionRouter], // For custom action buttons
    ['logs_channel_id', ServerSettingsInteractionRouter], // For logs channel modal
    ['category_id', ServerSettingsInteractionRouter], // For category modal

    // Add other features here as they're migrated:
    // ['player_link', PlayerLinkingInteractionRouter],
    // ['tickets', TicketInteractionRouter],
  ]);

  /**
   * Main dispatch method - routes interactions to appropriate handlers
   */
  static async dispatch(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
      } else if (interaction.isModalSubmit()) {
        await this.handleModalInteraction(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await this.handleSelectMenuInteraction(interaction);
      }
    } catch (error) {
      logger.error('Error in interaction dispatcher:', error);

      // Try to respond to the user if we haven't already - but only if the interaction hasn't been handled
      const errorMessage = 'An unexpected error occurred while processing your interaction.';

      try {
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: errorMessage, ephemeral: true });
        }
      } catch (replyError) {
        logger.error('Failed to send error message to user:', replyError);
      }
    }
  }

  /**
   * Handle button interactions
   */
  private static async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCustomId(interaction.customId);

    if (parsed.category !== 'b') {
      await interaction.reply({
        content: 'Invalid interaction type for button.',
        ephemeral: true,
      });
      return;
    }

    const router = this.getRouterForAction(parsed.action);

    if (router && router.handleButton) {
      await router.handleButton(interaction, parsed);
    } else {
      logger.warn(`No router found for button action: ${parsed.action}`);
      await interaction.reply({
        content: 'This feature is not yet implemented for buttons.',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle modal submit interactions
   */
  private static async handleModalInteraction(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCustomId(interaction.customId);

    console.log('🎯 Dispatcher - Modal Custom ID:', interaction.customId, 'Parsed:', parsed); // Debug logging

    if (parsed.category !== 'm') {
      await interaction.reply({
        content: 'Invalid interaction type for modal.',
        ephemeral: true,
      });
      return;
    }

    const router = this.getRouterForAction(parsed.action);
    console.log('📍 Found router:', !!router, 'for action:', parsed.action); // Debug logging

    if (router && router.handleModal) {
      await router.handleModal(interaction, parsed);
    } else {
      logger.warn(`No router found for modal action: ${parsed.action}`);
      await interaction.reply({
        content: 'This feature is not yet implemented for modals.',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle select menu interactions
   */
  private static async handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseCustomId(interaction.customId);
    console.log(parsed);
    if (parsed.category !== 's') {
      await interaction.reply({
        content: 'Invalid interaction type for select menu.',
        ephemeral: true,
      });
      return;
    }

    const router = this.getRouterForAction(parsed.action);

    if (router && router.handleSelectMenu) {
      await router.handleSelectMenu(interaction, parsed);
    } else {
      logger.warn(`No router found for select menu action: ${parsed.action}`);
      await interaction.reply({
        content: 'This feature is not yet implemented for select menus.',
        ephemeral: true,
      });
    }
  }

  /**
   * Determine which router should handle the given action
   */
  private static getRouterForAction(action: string): FeatureRouter | null {
    for (const [prefix, router] of this.featureRouters) {
      if (action.includes(prefix)) {
        return router;
      }
    }
    return null;
  }

  /**
   * Register a new feature router
   */
  static registerFeatureRouter(prefix: string, router: FeatureRouter): void {
    this.featureRouters.set(prefix, router);
    logger.info(`Registered feature router for: ${prefix}`);
  }

  /**
   * Get statistics about registered routers
   */
  static getStats(): { registeredFeatures: string[] } {
    return {
      registeredFeatures: Array.from(this.featureRouters.keys()),
    };
  }
}
