/**
 * Central Interaction Dispatcher
 * Routes Discord interactions to appropriate feature handlers
 */

import {
  Interaction,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  MessageFlags,
} from 'discord.js';
import { parseCustomId } from '../../utils/customId.js';
import type { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { MemberChannelInteractionRouter } from '../../features/member-channels/router.js';
import { ClanSettingsInteractionRouter } from '../../features/clan-settings/router.js';
import { ServerSettingsInteractionRouter } from '../../features/server-settings/router.js';
import { TicketInteractionRouter } from '../../features/tickets/router.js';
import { PlayerLinksInteractionRouter } from '../../features/player-links/router.js';
import logger from '../../logger.js';
import { ClanInvitesInteractionRouter } from '../../features/clan-invites/router.js';
import { RaceTrackingInteractionRouter } from '../../features/race-tracking/router.js';

// Define router interface
interface FeatureRouter {
  handleButton?: (interaction: ButtonInteraction, parsed: ParsedCustomId) => Promise<void>;
  handleModal?: (interaction: ModalSubmitInteraction, parsed: ParsedCustomId) => Promise<void>;
  handleModalSubmit?: (interaction: ModalSubmitInteraction, parsed: ParsedCustomId) => Promise<void>;
  handleSelectMenu?: (interaction: StringSelectMenuInteraction, parsed: ParsedCustomId) => Promise<void>;
}

export class InteractionDispatcher {
  /**
   * Feature routing map
   * Maps action prefixes to their respective router classes
   *
   * RULE: Use ONE consistent prefix per feature. All customIds for that feature should start with this prefix.
   * Example: All member channel actions should use 'memberChannel' prefix:
   *   - makeCustomId('m', 'memberChannel_create', guildId)
   *   - makeCustomId('b', 'memberChannel_confirm_123', guildId)
   *   - makeCustomId('s', 'memberChannel_select_456', guildId)
   */
  private static featureRouters = new Map<string, FeatureRouter>([
    // Member Channel actions - All start with 'memberChannel'
    ['memberChannel', MemberChannelInteractionRouter],

    // Clan Settings actions - All start with 'clanSettings'
    ['clanSettings', ClanSettingsInteractionRouter],

    // Server Settings actions - All start with 'serverSetting'
    ['serverSetting', ServerSettingsInteractionRouter],

    // Ticket actions - All start with 'ticket'
    ['ticket', TicketInteractionRouter],

    // Clan Invite Actions - All start with 'clanInvite'
    ['clanInvite', ClanInvitesInteractionRouter],

    // Links actions - All start with 'link' or 'players'
    ['link', PlayerLinksInteractionRouter],
    ['players', PlayerLinksInteractionRouter],

    // Add other features here as they're migrated:
    // ['playerLink', PlayerLinkingInteractionRouter],
    ['nudge', RaceTrackingInteractionRouter],
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
      if ((error as { code?: number }).code === 10062) {
        logger.warn('[InteractionDispatcher] Stale interaction (10062) — token already expired, ignoring.');
        return;
      }

      logger.error('Error in interaction dispatcher:', error);

      // Try to respond to the user if we haven't already - but only if the interaction hasn't been handled
      const errorMessage = 'An unexpected error occurred while processing your interaction.';

      try {
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
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
        flags: MessageFlags.Ephemeral,
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
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Handle modal submit interactions
   */
  private static async handleModalInteraction(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCustomId(interaction.customId);

    if (parsed.category !== 'm') {
      await interaction.reply({
        content: 'Invalid interaction type for modal.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const router = this.getRouterForAction(parsed.action);

    if (router) {
      // Support both new naming (handleModalSubmit) and legacy (handleModal)
      if (router.handleModalSubmit) {
        await router.handleModalSubmit(interaction, parsed);
      } else if (router.handleModal) {
        // TODO change routers to use handleModalSubmit and remove this fallback after migration is complete
        await router.handleModal(interaction, parsed);
      } else {
        logger.warn(`Router found but no modal handler for action: ${parsed.action}`);
        await interaction.reply({
          content: 'This feature is not yet implemented for modals.',
          flags: MessageFlags.Ephemeral,
        });
      }
    } else {
      logger.warn(`No router found for modal action: ${parsed.action}`);
      await interaction.reply({
        content: 'This feature is not yet implemented for modals.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Handle select menu interactions
   */
  private static async handleSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseCustomId(interaction.customId);
    if (parsed.category !== 's') {
      await interaction.reply({
        content: 'Invalid interaction type for select menu.',
        flags: MessageFlags.Ephemeral,
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
        flags: MessageFlags.Ephemeral,
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
