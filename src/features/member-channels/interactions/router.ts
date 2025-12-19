/**
 * Feature-based interaction router for member channels
 * Handles all member channel interactions in one place
 */

import {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import type { ParsedCustomId } from '../../../types/ParsedCustomId.js';
import type { Player } from '../../../api/CR_API.js';
import { memberChannelService } from '../service.js';
import {
  createAnyAccountModal,
  createAccountSelectionEmbed,
  createAccountSelectMenu,
  createAccountActionButtons,
} from '../components/ui-components.js';

export class MemberChannelInteractionRouter {
  /**
   * Route button interactions to appropriate handlers
   */
  static async handleButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, extra } = parsed;

    switch (action) {
      case 'member_channel_any_account':
        await this.handleAnyAccountButton(interaction, extra);
        break;

      case 'member_channel_continue':
        await this.handleContinueButton(interaction, extra);
        break;

      case 'member_channel_create':
        await this.handleCreateButton(interaction, extra);
        break;

      case 'member_channel_cancel':
        await this.handleCancelButton(interaction, extra);
        break;

      default:
        await interaction.reply({
          content: 'Unknown member channel action.',
          ephemeral: true,
        });
    }
  }

  /**
   * Route modal interactions to appropriate handlers
   */
  static async handleModal(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, extra } = parsed;

    console.log('🔍 Modal Router - Action:', action, 'Extra:', extra); // Debug logging

    switch (action) {
      case 'any_account_count_modal':
        await this.handleAnyAccountModal(interaction, extra);
        break;

      case 'member_channel': // From /create-member-channel command
      case 'create_member_channel':
        await this.handleCreateMemberChannelModal(interaction);
        break;

      default:
        await interaction.reply({
          content: 'Unknown member channel modal.',
          ephemeral: true,
        });
    }
  }

  /**
   * Route select menu interactions to appropriate handlers
   */
  static async handleSelectMenu(interaction: StringSelectMenuInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, extra } = parsed;

    switch (action) {
      case 'member_channel_account_select':
        await this.handleAccountSelect(interaction, extra);
        break;

      default:
        await interaction.reply({
          content: 'Unknown member channel select menu.',
          ephemeral: true,
        });
    }
  }

  // Private handlers for each specific interaction
  private static async handleAnyAccountButton(
    interaction: ButtonInteraction,
    extra: ParsedCustomId['extra']
  ): Promise<void> {
    try {
      // Get session ID and max accounts from extra data
      const userIndex = Array.isArray(extra) && extra.length > 0 ? parseInt(extra[0]) : 0;
      const sessionId = Array.isArray(extra) && extra.length > 1 ? extra[1] : null;

      if (!sessionId) {
        await interaction.reply({
          content: 'Session not found. Please try again.',
          ephemeral: true,
        });
        return;
      }

      // Get account data to determine max accounts for this user
      const accountData = memberChannelService.getAccountSelectionData(sessionId);
      if (!accountData) {
        await interaction.reply({
          content: '❌ Session expired. Please try again.',
          ephemeral: true,
        });
        return;
      }

      const multipleAccountUserIds = Array.from(accountData.finalMultipleAccountUsers.keys());
      const currentUserId = multipleAccountUserIds[userIndex];
      const availableAccounts = accountData.finalMultipleAccountUsers.get(currentUserId) || [];
      const maxAccounts = availableAccounts.length;

      // Show modal for account count selection
      const modal = createAnyAccountModal(interaction.guildId!, maxAccounts, sessionId, interaction.user.id);
      await interaction.showModal(modal);
    } catch (error) {
      console.error('Error in any account button:', error);
      await interaction.reply({
        content: 'An error occurred while processing your request.',
        ephemeral: true,
      });
    }
  }

  private static async handleContinueButton(
    interaction: ButtonInteraction,
    extra: ParsedCustomId['extra']
  ): Promise<void> {
    try {
      // Get session ID from extra data
      const sessionId = Array.isArray(extra) && extra.length >= 2 ? extra[1] : null;
      if (!sessionId) {
        await interaction.reply({
          content: 'Session not found. Please try again.',
          ephemeral: true,
        });
        return;
      }

      // Validate session belongs to this guild
      if (!memberChannelService.validateSessionGuild(sessionId, interaction.guildId!)) {
        await interaction.reply({
          content: 'Invalid session or guild mismatch.',
          ephemeral: true,
        });
        return;
      }

      // Continue with pre-selected accounts (from playertag input) and move to next user
      await this.moveToNextUserOrFinish(interaction, sessionId);
    } catch (error) {
      console.error('Error in continue button:', error);
      await interaction.reply({
        content: 'An error occurred while processing your request.',
        ephemeral: true,
      });
    }
  }

  private static async handleCreateButton(
    interaction: ButtonInteraction,
    extra: ParsedCustomId['extra']
  ): Promise<void> {
    try {
      // Implementation for final creation
      console.log('Create button extra:', extra); // For debugging
      await interaction.reply({
        content: 'Create button functionality will be implemented here.',
        ephemeral: true,
      });
    } catch (error) {
      console.error('Error in create button:', error);
      await interaction.reply({
        content: 'An error occurred while processing your request.',
        ephemeral: true,
      });
    }
  }

  private static async handleCancelButton(
    interaction: ButtonInteraction,
    extra: ParsedCustomId['extra']
  ): Promise<void> {
    try {
      // Clean up session and respond
      const sessionId = Array.isArray(extra) && extra.length > 0 ? extra[0] : null;
      if (sessionId) {
        memberChannelService.endSession(sessionId);
      }

      await interaction.update({
        content: 'Member channel creation cancelled.',
        components: [],
        embeds: [],
      });
    } catch (error) {
      console.error('Error in cancel button:', error);
      await interaction.reply({
        content: 'An error occurred while canceling.',
        ephemeral: true,
      });
    }
  }

  private static async handleAnyAccountModal(
    interaction: ModalSubmitInteraction,
    extra: ParsedCustomId['extra']
  ): Promise<void> {
    try {
      // Get selected account count from modal
      const selectedValue = interaction.fields.getTextInputValue('input');
      const accountCount = parseInt(selectedValue);

      console.log('Modal extra:', extra); // For debugging

      if (isNaN(accountCount) || accountCount < 1) {
        await interaction.reply({
          content: 'Please select a valid number of accounts.',
          ephemeral: true,
        });
        return;
      }

      // Get session ID from extra data
      const sessionId = Array.isArray(extra) && extra.length > 0 ? extra[0] : null;
      if (!sessionId) {
        await interaction.reply({
          content: 'Session not found. Please try again.',
          ephemeral: true,
        });
        return;
      }

      // Validate session belongs to this guild
      if (!memberChannelService.validateSessionGuild(sessionId, interaction.guildId!)) {
        await interaction.reply({
          content: 'Invalid session or guild mismatch.',
          ephemeral: true,
        });
        return;
      }

      // Get current account data
      const accountData = memberChannelService.getAccountSelectionData(sessionId);
      if (!accountData) {
        await interaction.reply({
          content: '❌ Session expired. Please try again.',
          ephemeral: true,
        });
        return;
      }

      // Get current user
      const multipleAccountUserIds = Array.from(accountData.finalMultipleAccountUsers.keys());
      const currentUserId = multipleAccountUserIds[accountData.currentUserIndex];

      // Store the user's any account count selection
      memberChannelService.processUserAccountSelection(sessionId, currentUserId, {
        type: 'any',
        count: accountCount,
      });

      console.log(`User ${currentUserId} selected any ${accountCount} accounts`);

      // Reply to modal first
      await interaction.reply({
        content: `✅ You selected any ${accountCount} account(s). Processing next user...`,
        ephemeral: true,
      });

      // Move to next user or finish (we need to get the original interaction somehow)
      // For now, we'll just indicate success - this needs to be handled differently
      // since we can't call moveToNextUserOrFinish from a modal response
    } catch (error) {
      console.error('Error in any account modal:', error);
      await interaction.reply({
        content: 'An error occurred while processing your selection.',
        ephemeral: true,
      });
    }
  }

  private static async handleCreateMemberChannelModal(interaction: ModalSubmitInteraction): Promise<void> {
    try {
      await interaction.deferReply({ ephemeral: true });

      // 1. Parse form data
      const channelName = interaction.fields.getTextInputValue('channel_name_input');
      const playertagsInput = interaction.fields.getTextInputValue('playertags_input') || '';
      const discordIdsInput = interaction.fields.getTextInputValue('discord_ids_input') || '';

      console.log('Create member channel modal data:', { channelName, playertagsInput, discordIdsInput });

      // 2. Call business logic service with enhanced parsing
      const result = await memberChannelService.processChannelCreationRequest({
        channelName,
        playertags: [playertagsInput], // Pass as array for the service to parse
        discordIds: [discordIdsInput], // Pass as array for the service to parse
        guildId: interaction.guildId!,
        creatorId: interaction.user.id,
      });

      // Store the complex data in the service session for later use
      memberChannelService.storeAccountSelectionData(result.sessionId, {
        finalSingleAccountUsers: result.finalSingleAccountUsers,
        finalMultipleAccountUsers: result.finalMultipleAccountUsers,
        preSelectedAccounts: result.preSelectedAccounts,
        channelName: result.channelName,
      });
      console.log('Processing result:', {
        totalAccounts: result.totalLinkedAccounts,
        needsSelection: result.needsAccountSelection,
        singleUsers: result.finalSingleAccountUsers.size,
        multipleUsers: result.finalMultipleAccountUsers.size,
      });

      // 3. Handle result based on what's needed
      if (result.needsAccountSelection) {
        // Users have multiple accounts and need to select specific ones
        const multipleAccountUserIds = Array.from(result.finalMultipleAccountUsers.keys());
        const firstUserId = multipleAccountUserIds[0];
        const firstUserPlayertags = result.finalMultipleAccountUsers.get(firstUserId)!;

        // TODO
        // Recreate the embeds and buttons in prepareAccountSelection

        // Prepare account selection data for the first user
        const selectionData = await memberChannelService.prepareAccountSelectionForUser(
          interaction.guildId!,
          firstUserId,
          firstUserPlayertags,
          0, // First user (index 0)
          multipleAccountUserIds.length,
          result.preSelectedAccounts.get(firstUserId) || []
        );

        // Show the account selection UI
        await this.showAccountSelectionForUser(interaction, selectionData, result.sessionId);
      } else if (result.totalLinkedAccounts > 0) {
        // No account selection needed, all users have single accounts - create directly
        const channelResult = await memberChannelService.createDiscordChannel(result.sessionId, interaction.guildId!);

        if (channelResult.success) {
          await interaction.editReply({
            content:
              `✅ Member channel "${channelName}" created successfully!\n\n` +
              `**Added ${result.totalLinkedAccounts} users with single accounts.**`,
          });
        } else {
          await interaction.editReply({
            content: `❌ Failed to create channel: ${channelResult.error}`,
          });
        }
      } else {
        // No linked accounts found
        await interaction.editReply({
          content:
            `❌ No linked accounts found for the provided playertags/Discord IDs.\n\n` +
            `Make sure the players are linked to Discord accounts in this server.`,
        });
      }
    } catch (error) {
      console.error('Error in create member channel modal:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: `❌ ${errorMessage}`,
          ephemeral: true,
        });
      } else {
        await interaction.editReply({
          content: `❌ ${errorMessage}`,
        });
      }
    }
  }

  private static async handleAccountSelect(
    interaction: StringSelectMenuInteraction,
    extra: ParsedCustomId['extra']
  ): Promise<void> {
    try {
      const selectedPlayerTags = interaction.values;

      // Get session ID from extra data
      const sessionId = Array.isArray(extra) && extra.length > 0 ? extra[0] : null;
      if (!sessionId) {
        await interaction.reply({
          content: 'Session not found. Please try again.',
          ephemeral: true,
        });
        return;
      }

      // Validate session belongs to this guild
      if (!memberChannelService.validateSessionGuild(sessionId, interaction.guildId!)) {
        await interaction.reply({
          content: 'Invalid session or guild mismatch.',
          ephemeral: true,
        });
        return;
      }

      // Get current account data
      const accountData = memberChannelService.getAccountSelectionData(sessionId);
      if (!accountData) {
        await interaction.reply({
          content: '❌ Session expired. Please try again.',
          ephemeral: true,
        });
        return;
      }

      // Get current user
      const multipleAccountUserIds = Array.from(accountData.finalMultipleAccountUsers.keys());
      const currentUserId = multipleAccountUserIds[accountData.currentUserIndex];

      // Store the user's selected accounts
      memberChannelService.processUserAccountSelection(sessionId, currentUserId, {
        type: 'specific',
        accounts: selectedPlayerTags,
      });

      console.log(`User ${currentUserId} selected ${selectedPlayerTags.length} accounts:`, selectedPlayerTags);

      // Move to next user or finish
      await this.moveToNextUserOrFinish(interaction, sessionId);
    } catch (error) {
      console.error('Error in account select:', error);
      await interaction.reply({
        content: 'An error occurred while processing your selection.',
        ephemeral: true,
      });
    }
  }

  /**
   * Show account selection UI for a specific user
   */
  private static async showAccountSelectionForUser(
    interaction: ModalSubmitInteraction | StringSelectMenuInteraction | ButtonInteraction,
    selectionData: {
      discordId: string;
      players: Player[];
      userIndex: number;
      totalUsers: number;
      preSelectedTags: string[];
    },
    sessionId: string
  ): Promise<void> {
    // Create the embed and UI components
    const embed = createAccountSelectionEmbed(
      {
        userId: selectionData.discordId,
        discordId: selectionData.discordId,
        guildId: interaction.guildId!,
        players: selectionData.players,
        userIndex: selectionData.userIndex,
        totalUsers: selectionData.totalUsers,
      },
      selectionData.players
    );

    // Create select menu with pre-selected options
    const selectMenu = createAccountSelectMenu(
      selectionData.players,
      interaction.guildId!,
      sessionId,
      interaction.user.id
    );

    // Pre-select accounts that were specified in playertag input
    if (selectionData.preSelectedTags.length > 0) {
      selectMenu.options.forEach((option) => {
        if (selectionData.preSelectedTags.includes(option.data.value!)) {
          option.setDefault(true);
        }
      });
    }

    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    // Create action buttons
    const buttonRow = createAccountActionButtons(
      interaction.guildId!,
      sessionId,
      interaction.user.id,
      selectionData.userIndex
    );

    const updateData = {
      content: '', // Clear content, use embed instead
      embeds: [embed],
      components: [selectRow, buttonRow],
    };

    if (interaction instanceof ModalSubmitInteraction) {
      await interaction.editReply(updateData);
    } else {
      await interaction.update(updateData);
    }
  }

  /**
   * Move to the next user in account selection or finish the flow
   */
  private static async moveToNextUserOrFinish(
    interaction: StringSelectMenuInteraction | ButtonInteraction,
    sessionId: string
  ): Promise<void> {
    const accountData = memberChannelService.getAccountSelectionData(sessionId);
    if (!accountData) {
      await interaction.reply({
        content: '❌ Session expired. Please try again.',
        ephemeral: true,
      });
      return;
    }

    // Move to next user
    const nextUserIndex = accountData.currentUserIndex + 1;
    const multipleAccountUserIds = Array.from(accountData.finalMultipleAccountUsers.keys());

    if (nextUserIndex >= multipleAccountUserIds.length) {
      // All users processed, create the channel
      await this.createFinalChannel(interaction, sessionId);
      return;
    }

    // Update session to next user
    memberChannelService.updateCurrentUserIndex(sessionId, nextUserIndex);

    // Get next user's data
    const nextUserId = multipleAccountUserIds[nextUserIndex];
    const nextUserPlayertags = accountData.finalMultipleAccountUsers.get(nextUserId)!;

    // Prepare next user's account selection
    const selectionData = await memberChannelService.prepareAccountSelectionForUser(
      interaction.guildId!,
      nextUserId,
      nextUserPlayertags,
      nextUserIndex,
      multipleAccountUserIds.length,
      accountData.preSelectedAccounts.get(nextUserId) || []
    );

    // Show next user's account selection
    await this.showAccountSelectionForUser(interaction, selectionData, sessionId);
  }

  /**
   * Create the final channel after all account selections are complete
   */
  private static async createFinalChannel(
    interaction: StringSelectMenuInteraction | ButtonInteraction,
    sessionId: string
  ): Promise<void> {
    const channelResult = await memberChannelService.createDiscordChannel(sessionId, interaction.guildId!);

    if (channelResult.success) {
      const accountData = memberChannelService.getAccountSelectionData(sessionId);
      const totalUsers =
        (accountData?.finalSingleAccountUsers.size || 0) + (accountData?.finalMultipleAccountUsers.size || 0);

      await interaction.update({
        content:
          `✅ Member channel "${accountData?.channelName || 'Unknown'}" created successfully!\n\n` +
          `**Added ${totalUsers} users with their selected accounts.**`,
        embeds: [],
        components: [],
      });
    } else {
      await interaction.update({
        content: `❌ Failed to create channel: ${channelResult.error}`,
        embeds: [],
        components: [],
      });
    }
  }
}
