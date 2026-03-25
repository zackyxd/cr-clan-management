import {
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  UserSelectMenuBuilder,
  LabelBuilder,
  ChannelType,
  Guild,
} from 'discord.js';
import { memberChannelService } from './service.js';
import type { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { makeCustomId } from '../../utils/customId.js';
import { pool } from '../../db.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { CR_API, FetchError, normalizeTag } from '../../api/CR_API.js';
import { clanInviteService } from '../clan-invites/service.js';
import { createInviteEmbed } from '../clan-invites/utils.js';
import { MemberData } from '../../utils/memberChannelHelpers.js';
import { buildMemberChannelCheckUI } from '../../utils/memberChannelCheckHelpers.js';
import logger from '../../logger.js';

/**
 * Router for member channel interactions
 * Handles all Discord UI interactions for the member channel creation flow
 *
 * EXECUTION FLOW:
 * [1] handleStartCreateChannelModal - User submits initial modal
 *     ↓
 * [2] showAccountSelection - Shows account selection UI (if multiple accounts exist)
 *     ↓
 * [3] handleAccountSelection - User selects specific accounts (OR)
 * [4] handleAnyAccountsButton - User clicks "Any X" button
 *     ↓
 * [5] handleAnyAccountsModal - User enters account count (OR)
 * [4.5] handleContinueButton - User clicks "Continue" to skip
 *     ↓
 * [6] showFinalConfirmation - Shows final confirmation UI
 *     ↓
 * [7] handleConfirmButton - User confirms and channel is created (OR)
 * [8] handleCancelButton - User cancels the creation
 *
 * [ROUTER] handleButton, handleModal, handleSelectMenu - Dispatcher methods
 */
export class MemberChannelInteractionRouter {
  // ============================================================================
  // STEP 1-2: Initial command and modal
  // ============================================================================

  /**
   * [1] FIRST INTERACTION: User submits the initial modal
   * Command: /member-channel create
   * Modal submit: User submitted channel creation form
   */
  static async handleStartCreateChannelModal(interaction: ModalSubmitInteraction, parsed: ParsedCustomId) {
    const channelName = interaction.fields.getTextInputValue('createMemberChannelNameInput');
    const playertags = interaction.fields.getTextInputValue('createMemberChannelPlayertagsInput');
    const discordIds = interaction.fields.getTextInputValue('createMemberChannelDiscordIdsInput');

    try {
      const sessionId = await memberChannelService.startChannelCreation(parsed.guildId, interaction.user.id, {
        channelName,
        playertags,
        discordIds,
      });

      const session = memberChannelService.getSession(sessionId);
      if (!session) {
        await interaction.editReply({ content: '❌ Failed to create session' });
        return;
      }

      if (session.multipleAccountUserIds.length > 0) {
        // Show first user's account selection
        await this.showAccountSelection(interaction, sessionId, 0);
      } else {
        // No selection needed, go straight to confirmation
        await this.showFinalConfirmation(interaction, sessionId);
      }
    } catch (error) {
      logger.error('[handleStartCreateChannelModal] Error:', error);
      await interaction.editReply({
        content: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        embeds: [],
      });
    }
  }

  // ============================================================================
  // STEP 8-9: Account selection for multiple account users
  // ============================================================================

  /**
   * [2] Show account selection UI for a user with multiple accounts
   * (Helper function - not directly called by dispatcher)
   */
  private static async showAccountSelection(
    interaction: ModalSubmitInteraction | StringSelectMenuInteraction | ButtonInteraction,
    sessionId: string,
    userIndex: number,
  ) {
    const data = await memberChannelService.getAccountSelectionData(sessionId, userIndex);
    if (!data) {
      await interaction.editReply({
        content: '❌ Session expired or invalid',
        components: [],
      });
      return;
    }

    console.log(`data received for account selection`, data);

    // Extract short ID (timestamp) from full sessionId for use in customIds
    const shortSessionId = sessionId.split('_')[2]; // guildId_userId_TIMESTAMP

    const embed = new EmbedBuilder()
      .setTitle(`Account Selection - User ${userIndex + 1} of ${data.totalUsers}`)
      .setDescription(
        `<@${data.discordId}> has multiple accounts. Select which ones to add.\n\n` +
          `**Options:**\n` +
          `* Use the dropdown to select specific accounts\n` +
          `* Click "Any X Accounts" to specify a count\n` +
          `* Click "Continue" to skip without selecting any`,
      )
      .setColor('Yellow');

    // Create string select menu with player options
    const selectCustomId = makeCustomId(
      's',
      `memberChannel_accounts_${shortSessionId}_${userIndex}`,
      interaction.guildId!,
    );
    console.log(`[Select Menu] Custom ID length: ${selectCustomId.length}, ID: ${selectCustomId}`);

    const select = new StringSelectMenuBuilder()
      .setCustomId(selectCustomId)
      .setPlaceholder('Select accounts (or use Continue to skip)')
      .setMinValues(1)
      .setMaxValues(data.players.length)
      .addOptions(
        data.players.map((player) => ({
          label: `${player.name} (Level ${player.expLevel})`,
          value: player.tag,
          description: player.tag,
        })),
      );

    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    // Create "Any X accounts" button to open modal
    const buttonCustomId = makeCustomId('b', `memberChannel_any_${shortSessionId}_${userIndex}`, interaction.guildId!);
    console.log(`[Button] Custom ID length: ${buttonCustomId.length}, ID: ${buttonCustomId}`);

    const anyButton = new ButtonBuilder()
      .setCustomId(buttonCustomId)
      .setLabel('Any X Accounts')
      .setStyle(ButtonStyle.Secondary);

    const continueButton = new ButtonBuilder()
      .setCustomId(makeCustomId('b', `memberChannel_continue_${shortSessionId}_${userIndex}`, interaction.guildId!))
      .setLabel('Continue')
      .setStyle(ButtonStyle.Primary);

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(anyButton, continueButton);

    const updateData = {
      content: '',
      embeds: [embed],
      components: [selectRow, buttonRow],
    };

    try {
      // Use editReply if interaction was already deferred or replied to
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(updateData);
      } else {
        await interaction.update(updateData);
      }
    } catch (error) {
      console.error('[showAccountSelection] Error updating interaction:', error);
      throw error;
    }
  }

  /**
   * [3] User selected specific accounts from the select menu
   * Handle string select menu: User selected specific accounts
   */
  static async handleAccountSelection(interaction: StringSelectMenuInteraction, parsed: ParsedCustomId) {
    await interaction.deferUpdate();
    console.log('handleaccountselection');
    // Extract short sessionId and userIndex from action: 'memberChannel_accounts_<shortId>_<userIndex>'
    const parts = parsed.action.replace('memberChannel_accounts_', '').split('_');
    const userIndex = parseInt(parts.pop()!, 10);
    const shortSessionId = parts.join('_');

    // Reconstruct full sessionId (handle both regular and add mode)
    let sessionId = `${parsed.guildId}_${interaction.user.id}_${shortSessionId}`;
    console.log(`[handleAccountSelection] Short ID: ${shortSessionId}, Full sessionId: ${sessionId}`);

    let session = memberChannelService.getSession(sessionId);
    if (!session) {
      // Try with '_add' suffix
      sessionId = `${parsed.guildId}_${interaction.user.id}_${shortSessionId}_add`;
      session = memberChannelService.getSession(sessionId);
    }

    if (!session) {
      await interaction.editReply({ content: '❌ Session expired', components: [] });
      return;
    }

    // Get selected playertags from interaction.values
    const selectedPlayertags = interaction.values;

    // Save selection to service
    const saved = memberChannelService.saveAccountSelection(sessionId, {
      discordId: session.multipleAccountUserIds[userIndex],
      type: 'specific',
      selectedTags: selectedPlayertags,
    });

    if (!saved) {
      await interaction.editReply({ content: '❌ Failed to save selection', components: [] });
      return;
    }

    // Refetch session to get updated currentUserIndex
    const updatedSession = memberChannelService.getSession(sessionId);
    if (!updatedSession) {
      await interaction.editReply({ content: '❌ Session expired', components: [] });
      return;
    }

    console.log(
      `[handleAccountSelection] After save - currentUserIndex: ${updatedSession.currentUserIndex}, total users: ${updatedSession.multipleAccountUserIds.length}`,
    );

    // Check if more users need selection, or show final confirmation
    if (updatedSession.currentUserIndex < updatedSession.multipleAccountUserIds.length) {
      await this.showAccountSelection(interaction, sessionId, updatedSession.currentUserIndex);
    } else {
      await this.showFinalConfirmation(interaction, sessionId);
    }
  }

  /**
   * [4] User clicked "Any X Accounts" button
   * Handle "Any X accounts" button: Show modal to enter count
   */
  static async handleAnyAccountsButton(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    // Extract short sessionId and userIndex from action: 'memberChannel_any_<shortId>_<userIndex>'
    const parts = parsed.action.replace('memberChannel_any_', '').split('_');
    const userIndexStr = parts.pop()!;
    const userIndex = parseInt(userIndexStr, 10);
    const shortSessionId = parts.join('_');

    // Reconstruct full sessionId to get available accounts (handle both regular and add mode)
    let sessionId = `${parsed.guildId}_${interaction.user.id}_${shortSessionId}`;
    let session = memberChannelService.getSession(sessionId);

    if (!session) {
      // Try with '_add' suffix
      sessionId = `${parsed.guildId}_${interaction.user.id}_${shortSessionId}_add`;
      session = memberChannelService.getSession(sessionId);
    }

    if (!session) {
      await interaction.reply({ content: '❌ Session expired', ephemeral: true });
      return;
    }

    // Get available accounts for this user
    const discordId = session.multipleAccountUserIds[userIndex];
    const availableAccounts = session.categorized.multipleAccountUsers.get(discordId) || [];
    const maxAccounts = availableAccounts.length;

    // Show modal asking "How many accounts?"
    const modal = new ModalBuilder()
      .setCustomId(makeCustomId('m', `memberChannel_anyCount_${shortSessionId}_${userIndexStr}`, interaction.guildId!))
      .setTitle('How many accounts?')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('account_count')
            .setLabel(`Number of accounts (max: ${maxAccounts})`)
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(2)
            .setPlaceholder(`Enter 1-${maxAccounts}`)
            .setRequired(true),
        ),
      );

    await interaction.showModal(modal);
  }

  /**
   * [5] User submitted the "Any X accounts" modal with a count
   * Handle "Any X accounts" modal submit
   */
  static async handleAnyAccountsModal(interaction: ModalSubmitInteraction, parsed: ParsedCustomId) {
    // await interaction.deferUpdate();

    // Extract short sessionId and userIndex from action: 'memberChannel_anyCount_<shortId>_<userIndex>'
    const parts = parsed.action.replace('memberChannel_anyCount_', '').split('_');
    const userIndex = parseInt(parts.pop()!, 10);
    const shortSessionId = parts.join('_');

    // Reconstruct full sessionId (handle both regular and add mode)
    let sessionId = `${parsed.guildId}_${interaction.user.id}_${shortSessionId}`;
    let session = memberChannelService.getSession(sessionId);

    if (!session) {
      // Try with '_add' suffix
      sessionId = `${parsed.guildId}_${interaction.user.id}_${shortSessionId}_add`;
      session = memberChannelService.getSession(sessionId);
    }

    if (!session) {
      await interaction.editReply({ content: '❌ Session expired', components: [] });
      return;
    }

    // Get available accounts for this user
    const discordId = session.multipleAccountUserIds[userIndex];
    const availableAccounts = session.categorized.multipleAccountUsers.get(discordId) || [];
    const maxAccounts = availableAccounts.length;

    // Get the count from modal input
    const countStr = interaction.fields.getTextInputValue('account_count');
    const count = parseInt(countStr, 10);

    // Validate count
    if (isNaN(count) || count < 1) {
      await interaction.editReply({ content: '❌ Invalid number. Please enter a positive number.', components: [] });
      return;
    }

    if (count > maxAccounts) {
      await interaction.editReply({
        content: `❌ This user only has **${maxAccounts}** linked account${maxAccounts !== 1 ? 's' : ''}. Please enter a number between 1 and ${maxAccounts}.`,
        components: [],
      });
      return;
    }

    // Save selection with type 'any' to service
    const saved = memberChannelService.saveAccountSelection(sessionId, {
      discordId: session.multipleAccountUserIds[userIndex],
      type: 'any',
      accountCount: count,
    });

    if (!saved) {
      await interaction.editReply({ content: '❌ Failed to save selection', components: [] });
      return;
    }

    // Refetch session to get updated currentUserIndex
    const updatedSession = memberChannelService.getSession(sessionId);
    if (!updatedSession) {
      await interaction.editReply({ content: '❌ Session expired', components: [] });
      return;
    }

    console.log(
      `[handleAnyAccountsModal] After save - currentUserIndex: ${updatedSession.currentUserIndex}, total users: ${updatedSession.multipleAccountUserIds.length}`,
    );

    // Continue to next user or final confirmation
    if (updatedSession.currentUserIndex < updatedSession.multipleAccountUserIds.length) {
      await this.showAccountSelection(interaction, sessionId, updatedSession.currentUserIndex);
    } else {
      await this.showFinalConfirmation(interaction, sessionId);
    }
  }

  // ============================================================================
  // STEP 10: Final confirmation
  // ============================================================================

  /**
   * [6] Show final confirmation embed with all accounts and channel info
   * (Helper function - not directly called by dispatcher)
   */
  private static async showFinalConfirmation(
    interaction: ModalSubmitInteraction | StringSelectMenuInteraction | ButtonInteraction,
    sessionId: string,
  ) {
    const session = memberChannelService.getSession(sessionId);
    const finalData = await memberChannelService.getFinalConfirmationData(sessionId);
    if (!finalData || !session) {
      await interaction.editReply({
        content: '❌ Failed to generate confirmation data',
        components: [],
      });
      return;
    }

    // TODO: Create embed showing:
    // - Channel name
    // - List of all users and their accounts
    // - Clan info if detected
    // - Total member count

    console.log('=== Final Confirmation Data ===');
    console.log('Channel Name:', finalData.channelName);
    console.log('Accounts (Map):', finalData.accounts);
    console.log('Accounts (Array):', Array.from(finalData.accounts.entries()));
    console.log('Clan Info:', finalData.clanInfo);
    console.log(
      'Full Data JSON:',
      JSON.stringify(
        {
          channelName: finalData.channelName,
          accounts: Array.from(finalData.accounts.entries()).map(([discordId, players]) => ({
            discordId,
            players,
          })),
          clanInfo: finalData.clanInfo,
        },
        null,
        2,
      ),
    );

    // Build description with all accounts
    const isAddMode = session.mode === 'add_member';
    let description = '';

    if (!isAddMode) {
      description += `**Channel Name:** ${finalData.channelName}\n`;
    }

    description += `**Clan Focus:** ${finalData.clanInfo ? `${finalData.clanInfo.clanName} (${finalData.clanInfo.clantag})` : 'None'}\n\n`;
    let totalAccountCount = 0;

    for (const [discordId, accountData] of finalData.accounts.entries()) {
      description += `**<@${discordId}>**\n`;

      if (Array.isArray(accountData)) {
        // Specific accounts selected
        totalAccountCount += accountData.length;
        const accountsList = accountData
          .map((p) => `* [${p.name}](<https://royaleapi.com/player/${p.tag.substring(1)}>)`)
          .join('\n');
        description += `${accountsList}\n\n`;
      } else if (accountData.type === 'any') {
        // 'Any X accounts' placeholder
        totalAccountCount += accountData.count;
        description += `* ${accountData.count} account${accountData.count !== 1 ? 's' : ''}\n\n`;
      }
    }

    description += `**Total:** ${totalAccountCount} account${totalAccountCount !== 1 ? 's' : ''} • ${finalData.accounts.size} member${finalData.accounts.size !== 1 ? 's' : ''}`;

    const embedTitle = isAddMode ? 'Confirm Adding Members' : 'Confirm Member Channel Creation';
    const embed = new EmbedBuilder().setTitle(embedTitle).setDescription(description).setColor('Green');

    // Calculate total character count
    const titleLength = embedTitle.length;
    const descriptionLength = description.length;
    const totalCharCount = titleLength + descriptionLength;

    console.log(
      `[Embed Character Count] Title: ${titleLength}, Description: ${descriptionLength}, Total: ${totalCharCount}/4096`,
    );

    // Extract short ID (timestamp) from full sessionId
    const shortSessionId = sessionId.split('_')[2];

    // Create confirm and cancel buttons
    const confirmCustomId = makeCustomId('b', `memberChannel_confirm_${shortSessionId}`, interaction.guildId!, {
      cooldown: 5,
    });
    console.log(`[Confirm Button] Custom ID length: ${confirmCustomId.length}, ID: ${confirmCustomId}`);

    const confirmButtonLabel = isAddMode ? 'Add Members' : 'Create Channel';
    const confirmButton = new ButtonBuilder()
      .setCustomId(confirmCustomId)
      .setLabel(confirmButtonLabel)
      .setStyle(ButtonStyle.Success);

    const cancelCustomId = makeCustomId('b', `memberChannel_cancel_${shortSessionId}`, interaction.guildId!, {
      cooldown: 5,
    });
    console.log(`[Cancel Button] Custom ID length: ${cancelCustomId.length}, ID: ${cancelCustomId}`);

    const cancelButton = new ButtonBuilder()
      .setCustomId(cancelCustomId)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger);

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

    const updateData = {
      content: '',
      embeds: [embed],
      components: [buttonRow],
    };

    // Use editReply for deferred interactions (ModalSubmit or StringSelectMenu after deferUpdate)
    // Use update for non-deferred button interactions
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(updateData);
    } else {
      await interaction.update(updateData);
    }
  }

  /**
   * [7] User clicked "Create Channel" confirm button
   * Handle confirm button: Actually create the channel OR add members to existing channel
   */
  static async handleConfirmButton(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    await interaction.deferUpdate();

    // Extract short sessionId from action: 'memberChannel_confirm_<shortId>'
    const shortSessionId = parsed.action.replace('memberChannel_confirm_', '');

    // Reconstruct full sessionId (handle both regular and add mode)
    let sessionId = `${parsed.guildId}_${interaction.user.id}_${shortSessionId}`;

    // Check if it's an add session (sessionId contains '_add')
    let session = memberChannelService.getSession(sessionId);
    if (!session) {
      // Try with '_add' suffix
      sessionId = `${parsed.guildId}_${interaction.user.id}_${shortSessionId}_add`;
      session = memberChannelService.getSession(sessionId);
    }

    console.log(`[handleConfirmButton] Short ID: ${shortSessionId}, Full sessionId: ${sessionId}`);

    if (!interaction.guild) {
      await interaction.editReply({
        content: '❌ This command must be used in a server.',
        components: [],
      });
      return;
    }

    if (!session) {
      await interaction.editReply({
        content: '❌ Session expired or not found.',
        components: [],
      });
      return;
    }

    // Check if we're adding members or creating a new channel
    if (session.mode === 'add_member' && session.targetChannelId) {
      // Adding members to existing channel
      const result = await memberChannelService.addMembersToChannel(
        sessionId,
        interaction.guild,
        session.targetChannelId,
      );

      if (result.success) {
        await interaction.editReply({
          content: `✅ Successfully added ${result.addedCount} member${result.addedCount !== 1 ? 's' : ''} to the channel!`,
          embeds: [],
          components: [],
        });

        // Send notification in the channel about added members
        if (result.addedMembers && result.addedMembers.length > 0) {
          await this.notifyAddedMembers(interaction.guild, session.targetChannelId, result.addedMembers);
        }
      } else {
        await interaction.editReply({
          content: `❌ Failed to add members: ${result.error}`,
          components: [],
        });
      }
    } else {
      // Creating new channel
      const result = await memberChannelService.createChannel(sessionId, interaction.guild);

      if (result.success && result.channelId) {
        await interaction.editReply({
          content: `✅ <#${result.channelId}> created successfully!`,
          embeds: [],
          components: [],
        });

        // Send initial member status message
        await this.sendInitialMemberStatus(interaction, result.channelId, parsed.guildId);
      } else {
        await interaction.editReply({
          content: `❌ Failed to create channel: ${result.error}`,
          components: [],
        });
      }
    }
  }

  /**
   * [8] User clicked "Cancel" button
   * Handle cancel button: Cancel channel creation
   */
  static async handleCancelButton(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    // Extract short sessionId from action: 'memberChannel_cancel_<shortId>'
    const shortSessionId = parsed.action.replace('memberChannel_cancel_', '');

    // Reconstruct full sessionId (handle both regular and add mode)
    let sessionId = `${parsed.guildId}_${interaction.user.id}_${shortSessionId}`;
    console.log(`[handleCancelButton] Short ID: ${shortSessionId}, Full sessionId: ${sessionId}`);

    // Clean up the session
    let session = memberChannelService.getSession(sessionId);
    if (!session) {
      // Try with '_add' suffix
      sessionId = `${parsed.guildId}_${interaction.user.id}_${shortSessionId}_add`;
      session = memberChannelService.getSession(sessionId);
    }

    const isAddMode = session?.mode === 'add_member';
    if (session) {
      // TODO: Add a deleteSession method to service if needed
    }

    const cancelMessage = isAddMode ? '❌ Adding members cancelled' : '❌ Channel creation cancelled';
    await interaction.update({
      content: cancelMessage,
      embeds: [],
      components: [],
    });
  }

  /**
   * [4.5] User clicked "Continue" button to skip account selection
   * Handle "Continue" button: Skip this user's account selection and move to next user or final confirmation
   */
  static async handleContinueButton(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    // await interaction.deferUpdate();

    // Extract short sessionId and userIndex from action: 'memberChannel_continue_<shortId>_<userIndex>'
    const parts = parsed.action.replace('memberChannel_continue_', '').split('_');
    const userIndex = parseInt(parts.pop()!, 10);
    const shortSessionId = parts.join('_');

    // Reconstruct full sessionId (handle both regular and add mode)
    let sessionId = `${parsed.guildId}_${interaction.user.id}_${shortSessionId}`;
    console.log(`[handleContinueButton] Short ID: ${shortSessionId}, Full sessionId: ${sessionId}`);

    let session = memberChannelService.getSession(sessionId);
    if (!session) {
      // Try with '_add' suffix
      sessionId = `${parsed.guildId}_${interaction.user.id}_${shortSessionId}_add`;
      session = memberChannelService.getSession(sessionId);
    }

    if (!session) {
      await interaction.editReply({ content: '❌ Session expired', components: [] });
      return;
    }

    // Save empty selection (user chose to skip)
    const saved = memberChannelService.saveAccountSelection(sessionId, {
      discordId: session.multipleAccountUserIds[userIndex],
      type: 'skip',
    });

    if (!saved) {
      await interaction.editReply({ content: '❌ Failed to save selection', components: [] });
      return;
    }

    // Refetch session to get updated currentUserIndex
    const updatedSession = memberChannelService.getSession(sessionId);
    if (!updatedSession) {
      await interaction.editReply({ content: '❌ Session expired', components: [] });
      return;
    }

    console.log(
      `[handleContinueButton] After skip - currentUserIndex: ${updatedSession.currentUserIndex}, total users: ${updatedSession.multipleAccountUserIds.length}`,
    );

    // Continue to next user or final confirmation
    if (updatedSession.currentUserIndex < updatedSession.multipleAccountUserIds.length) {
      await this.showAccountSelection(interaction, sessionId, updatedSession.currentUserIndex);
    } else {
      await this.showFinalConfirmation(interaction, sessionId);
    }
  }

  // ============================================================================
  // Add Members Flow
  // ============================================================================

  /**
   * Handle "Add Members" button click - show modal for input
   */
  static async handleAddMembersButton(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    const modal = new ModalBuilder()
      .setCustomId(makeCustomId('m', 'memberChannel_addMemberModal', interaction.guildId!))
      .setTitle('Add Members to Channel')
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Select Members to Add')
          .setDescription('Choose Discord members from the list')
          .setUserSelectMenuComponent(
            new UserSelectMenuBuilder()
              .setCustomId('addMemberUsersSelect')
              .setMinValues(0)
              .setMaxValues(25)
              .setRequired(false),
          ),
      )
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('addMemberPlayertagsInput')
            .setLabel('Player Tags (comma or space separated)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('#ABC123, #DEF456 or #ABC123 #DEF456')
            .setRequired(false),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('addMemberDiscordIdsInput')
            .setLabel('Additional Discord IDs (space separated)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('123456789012345678 @user1 @user2')
            .setRequired(false),
        ),
      );

    await interaction.showModal(modal);
  }

  // ============================================================================
  // Remove Members Flow
  // ============================================================================

  /**
   * Handle "Remove Member" button click - show modal for input
   */
  static async handleRemoveMembersButton(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    const modal = new ModalBuilder()
      .setCustomId(makeCustomId('m', 'memberChannel_removeMemberModal', interaction.guildId!))
      .setTitle('Remove Members from Channel')
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Select Members to Remove')
          .setDescription('Choose Discord members from the list')
          .setUserSelectMenuComponent(
            new UserSelectMenuBuilder()
              .setCustomId('removeMemberUsersSelect')
              .setMinValues(0)
              .setMaxValues(25)
              .setRequired(false),
          ),
      )
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('removeMemberPlayertagsInput')
            .setLabel('Player Tags (comma or space separated)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('#ABC123, #DEF456 or #ABC123 #DEF456')
            .setRequired(false),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('removeMemberDiscordIdsInput')
            .setLabel('Additional Discord IDs (space separated)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('123456789012345678 @user1 @user2')
            .setRequired(false),
        ),
      );

    await interaction.showModal(modal);
  }

  /**
   * Handle modal submission for removing members
   */
  static async handleRemoveMemberModal(interaction: ModalSubmitInteraction, parsed: ParsedCustomId) {
    const playertags = interaction.fields.getTextInputValue('removeMemberPlayertagsInput');
    const discordIds = interaction.fields.getTextInputValue('removeMemberDiscordIdsInput');

    // Get selected users from the user select menu
    const selectedUsers = interaction.fields.getSelectedUsers('removeMemberUsersSelect');
    const selectedUserIds = selectedUsers ? Array.from(selectedUsers.values()).map((user) => user.id) : [];

    // Combine selected users with manually entered Discord IDs
    const manualDiscordIds = discordIds
      .split(/[\s,]+/)
      .map((id) => id.replace(/[<@!>]/g, '').trim())
      .filter((id) => id.length > 0);

    const allDiscordIds = [...selectedUserIds, ...manualDiscordIds];

    if (!playertags.trim() && allDiscordIds.length === 0) {
      await interaction.editReply({ content: '❌ Please select or provide at least one member or player tag.' });
      return;
    }

    try {
      // Fetch current members
      const result = await pool.query(`SELECT members FROM member_channels WHERE guild_id = $1 AND channel_id = $2`, [
        parsed.guildId,
        interaction.channelId,
      ]);

      if (result.rowCount === 0) {
        await interaction.editReply({ content: '❌ Member channel not found.' });
        return;
      }

      const members: MemberData[] = result.rows[0].members;
      const removedMembers: string[] = [];

      // Parse input playertags
      const inputPlayertags = playertags
        .split(/[\s,]+/)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0 && tag.startsWith('#'));
      const normalizedPlayertags = inputPlayertags.map((tag: string) => normalizeTag(tag));

      // inputDiscordIds already contains both selected users and manual entries
      const inputDiscordIds = allDiscordIds;

      // Track members to remove and members to update
      const membersToKeep: MemberData[] = [];

      for (const member of members) {
        const { discordId, players } = member;
        let shouldKeep = true;
        let updatedPlayers = players;

        // Check if Discord ID should be removed
        if (inputDiscordIds.includes(discordId)) {
          // If member has 'any' type, remove them completely
          if (!Array.isArray(players)) {
            shouldKeep = false;
            removedMembers.push(`<@${discordId}> (any ${players.count} accounts)`);
            continue;
          } else {
            // If specific accounts, remove all of them
            shouldKeep = false;
            removedMembers.push(`<@${discordId}> (${players.length} accounts)`);
            continue;
          }
        }

        // Check if specific playertags should be removed
        if (Array.isArray(players)) {
          const remainingPlayers = players.filter((player) => {
            const isRemoved = normalizedPlayertags.includes(normalizeTag(player.tag));
            if (isRemoved) {
              removedMembers.push(`${player.name} (${player.tag})`);
            }
            return !isRemoved;
          });

          // If all accounts removed, don't keep this member
          if (remainingPlayers.length === 0) {
            shouldKeep = false;
          } else if (remainingPlayers.length < players.length) {
            // Some accounts removed, keep member with remaining accounts
            updatedPlayers = remainingPlayers;
          }
        }

        if (shouldKeep) {
          membersToKeep.push({
            discordId,
            players: updatedPlayers,
          });
        }
      }

      if (removedMembers.length === 0) {
        await interaction.editReply({
          content: '❌ No matching members or playertags found to remove.',
        });
        return;
      }

      // Update database
      await pool.query(`UPDATE member_channels SET members = $1 WHERE guild_id = $2 AND channel_id = $3`, [
        JSON.stringify(membersToKeep),
        parsed.guildId,
        interaction.channelId,
      ]);

      // Log member removal (fire-and-forget)
      memberChannelService.logMembersRemoved(
        interaction.client,
        parsed.guildId,
        interaction.channelId!,
        interaction.user.id,
        removedMembers,
      );

      // Update channel permissions - remove users who were completely removed
      if (interaction.guild && interaction.channel && 'permissionOverwrites' in interaction.channel) {
        const remainingDiscordIds = new Set(membersToKeep.map((m) => m.discordId));
        const originalDiscordIds = members.map((m) => m.discordId);

        for (const discordId of originalDiscordIds) {
          if (!remainingDiscordIds.has(discordId)) {
            try {
              await interaction.channel.permissionOverwrites.delete(discordId);
            } catch (error) {
              console.warn(`[removeMember] Could not remove permissions for user ${discordId}:`, error);
            }
          }
        }
      }

      const removedList = removedMembers.slice(0, 10).join('\n');
      const moreCount = removedMembers.length > 10 ? `\n... and ${removedMembers.length - 10} more` : '';

      await interaction.editReply({
        content: `✅ Successfully removed ${removedMembers.length} member(s)/account(s):\n${removedList}${moreCount}`,
      });
    } catch (error) {
      console.error('[handleRemoveMemberModal] Error:', error);
      await interaction.editReply({
        content: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  /**
   * Handle modal submission for adding members
   */
  static async handleAddMemberModal(interaction: ModalSubmitInteraction, parsed: ParsedCustomId) {
    // await interaction.deferReply({ ephemeral: true });

    const playertags = interaction.fields.getTextInputValue('addMemberPlayertagsInput');
    const discordIds = interaction.fields.getTextInputValue('addMemberDiscordIdsInput');

    // Get selected users from the user select menu
    const selectedUsers = interaction.fields.getSelectedUsers('addMemberUsersSelect');
    const selectedUserIds = selectedUsers ? Array.from(selectedUsers.values()).map((user) => user.id) : [];

    // Combine selected users with manually entered Discord IDs
    const manualDiscordIds = discordIds
      .split(/[\s,]+/)
      .map((id) => id.replace(/[<@!>]/g, '').trim())
      .filter((id) => id.length > 0);

    const allDiscordIds = [...selectedUserIds, ...manualDiscordIds].join(' ');

    if (!playertags.trim() && selectedUserIds.length === 0 && manualDiscordIds.length === 0) {
      await interaction.editReply({ content: '❌ Please select or provide at least one member or player tag.' });
      return;
    }

    try {
      const sessionId = await memberChannelService.startAddingMembers(
        parsed.guildId,
        interaction.channelId!,
        interaction.user.id,
        { playertags, discordIds: allDiscordIds },
      );

      const session = memberChannelService.getSession(sessionId);
      if (!session) {
        await interaction.editReply({ content: '❌ Failed to create session' });
        return;
      }

      // Show error messages for invalid inputs if any
      const errorMessages: string[] = [];
      if (session.invalidPlayertags.length > 0) {
        errorMessages.push(`⚠️ Invalid playertags: ${session.invalidPlayertags.join(', ')}`);
      }
      if (session.invalidDiscordIds.length > 0) {
        errorMessages.push(`⚠️ Invalid Discord IDs: ${session.invalidDiscordIds.join(', ')}`);
      }

      if (
        errorMessages.length > 0 &&
        session.categorized.finalAccounts.size === 0 &&
        session.categorized.singleAccountUsers.size === 0 &&
        session.multipleAccountUserIds.length === 0
      ) {
        // All inputs were invalid
        await interaction.editReply({ content: errorMessages.join('\n') + '\n\n❌ No valid accounts found.' });
        return;
      }

      // Reuse the same flow as creation
      if (session.multipleAccountUserIds.length > 0) {
        await this.showAccountSelection(interaction, sessionId, 0);
      } else {
        await this.showFinalConfirmation(interaction, sessionId);
      }
    } catch (error) {
      console.error('[handleAddMemberModal] Error:', error);
      await interaction.editReply({
        content: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  static async handleRenameChannelModal(interaction: ModalSubmitInteraction, parsed: ParsedCustomId) {
    const newName = interaction.fields.getTextInputValue('renameChannelInput').trim();

    if (newName.length === 0 || newName.length > 30) {
      await interaction.editReply({ content: '❌ Channel name must be between 1 and 30 characters.' });
      return;
    }
    try {
      // Ensure channel is a guild text channel, not a DM
      if (!interaction.channel || interaction.channel.type === ChannelType.DM || !('setName' in interaction.channel)) {
        await interaction.editReply({
          content: '❌ This command must be used in a server channel.',
        });
        return;
      }

      // Check rate limit - 10 minutes
      const rateCheck = await pool.query(
        `SELECT last_renamed_at FROM member_channels WHERE guild_id = $1 AND channel_id = $2`,
        [parsed.guildId, interaction.channelId],
      );

      if (rateCheck.rows[0]?.last_renamed_at) {
        const lastRenamed = new Date(rateCheck.rows[0].last_renamed_at);
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

        if (lastRenamed > tenMinutesAgo) {
          const timeLeft = Math.ceil((lastRenamed.getTime() + 10 * 60 * 1000 - Date.now()) / 60000);
          await interaction.editReply({
            content: `❌ Channel was renamed recently. Try again <t:${Math.floor((lastRenamed.getTime() + 10 * 60 * 1000) / 1000)}:R>.`,
          });
          return;
        }
      }

      let newChannelName = newName;
      const oldChannelName = interaction.channel.name;
      if (interaction.channel.name.startsWith('🔒')) {
        newChannelName = `🔒 ${newChannelName}`;
      }

      // Rename the channel
      await interaction.channel.setName(newChannelName);

      // Update database with new name and timestamp
      await pool.query(
        `UPDATE member_channels 
         SET channel_name = $1, last_renamed_at = NOW() 
         WHERE guild_id = $2 AND channel_id = $3`,
        [newName, parsed.guildId, interaction.channelId],
      );

      await interaction.editReply({ content: `✅ Channel renamed to ${newChannelName}` });

      // Log channel rename (fire-and-forget)
      memberChannelService.logChannelRenamed(
        interaction.client,
        parsed.guildId,
        interaction.channelId!,
        interaction.user.id,
        oldChannelName,
        newChannelName,
      );
    } catch (error) {
      logger.error('[handleRenameChannelModal] Error:', error);
      await interaction.editReply({
        content: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  // ============================================================================
  // Check and Ping Members
  // ============================================================================

  static async handleCheckMembersButton(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    await interaction.deferReply({ ephemeral: true });

    const members = await pool.query(
      `
      SELECT clantag_focus, clan_name_focus, members FROM member_channels WHERE guild_id = $1 AND channel_id = $2
      `,
      [parsed.guildId, interaction.channelId],
    );

    if (members.rowCount === 0) {
      await interaction.editReply({ content: '❌ No member channel found for this channel.' });
      return;
    }

    if (!members.rows[0].clan_name_focus || !members.rows[0].clantag_focus) {
      const embed = new EmbedBuilder()
        .setDescription(
          '❌ This member channel does not have a clan focus set. Please set a clan focus to use this command.',
        )
        .setColor(EmbedColor.FAIL);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const memberList = members.rows[0].members;

    // Fetch clan info to check members against
    const clanInfo = await CR_API.getClan(members.rows[0].clantag_focus);
    if ('error' in clanInfo) {
      await interaction.editReply({
        embeds: [
          clanInfo.embed ?? new EmbedBuilder().setDescription('❌ Failed to fetch clan information.').setColor('Red'),
        ],
      });
      return;
    }
    if (!clanInfo) {
      await interaction.editReply({ content: '❌ Failed to fetch clan info from API.' });
      return;
    }

    // Create a Set of clan member tags for fast lookup
    const clanMemberTags = new Set(clanInfo.memberList.map((m) => m.tag));

    // Check each member's status
    const statusLines: string[] = [];

    for (const member of memberList) {
      const { discordId, players, joiningLate } = member;
      const lateEmoji = joiningLate ? ' 🕐' : '';

      if (Array.isArray(players)) {
        // Specific accounts - show player names
        for (const player of players) {
          const isInClan = clanMemberTags.has(player.tag);
          if (isInClan) {
            statusLines.push(`✅ ${player.name} ${lateEmoji}`);
          } else {
            statusLines.push(`❌ ${player.name} ${lateEmoji}`);
          }
        }
      } else if (players.type === 'any') {
        // 'Any X accounts' - show Discord mention with count
        const userAccountsResult = await pool.query(
          `SELECT playertag FROM user_playertags WHERE guild_id = $1 AND discord_id = $2`,
          [parsed.guildId, discordId],
        );

        const userTags = userAccountsResult.rows.map((r) => r.playertag);
        const accountsInClan = userTags.filter((tag) => clanMemberTags.has(tag));

        const meetsRequirement = accountsInClan.length >= players.count;

        if (meetsRequirement) {
          statusLines.push(`✅ <@${discordId}> - ${accountsInClan.length}/${players.count} accounts ${lateEmoji}`);
        } else {
          statusLines.push(`❌ <@${discordId}> - ${accountsInClan.length}/${players.count} accounts ${lateEmoji}`);
        }
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(`Member Status - ${members.rows[0].clan_name_focus}`)
      .setDescription(statusLines.join('\n') || 'No members to check')
      .setColor('Blue');

    await interaction.editReply({ embeds: [embed] });
  }

  static async handleChangeFocusButton(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Fetch all clans for this guild, ordered by clan trophies
    const clansRes = await pool.query(
      `
      SELECT clantag, clan_name, clan_trophies
      FROM clans
      WHERE guild_id = $1
      ORDER BY clan_trophies DESC
      `,
      [parsed.guildId],
    );

    if (clansRes.rows.length === 0) {
      await interaction.editReply({
        content: '❌ No clans are linked to this server. Use `/add-clan` first.',
      });
      return;
    }

    // Build select menu options from clans
    const options = clansRes.rows.map((clan: { clantag: string; clan_name: string; clan_trophies: number }) => ({
      label: clan.clan_name,
      description: `${clan.clantag} • ${clan.clan_trophies.toLocaleString()} 🏆`,
      value: clan.clantag,
    }));

    // Add "Remove Focus" option
    options.push({
      label: 'Remove Clan Focus',
      description: 'Clear the clan focus for this channel',
      value: 'REMOVE_FOCUS',
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(
        makeCustomId('s', `memberChannel_selectClanFocus_${interaction.channelId}`, parsed.guildId, { cooldown: 5 }),
      )
      .setPlaceholder('Select a clan or remove focus')
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    const embed = new EmbedBuilder()
      .setTitle('Change Clan Focus')
      .setDescription('Select which clan this member channel should focus on:')
      .setColor('Blue');

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  }

  static async handleSelectClanFocus(interaction: StringSelectMenuInteraction, parsed: ParsedCustomId) {
    await interaction.deferUpdate();

    // Extract channelId from action: 'memberChannel_selectClanFocus_<channelId>'
    const channelId = parsed.action.replace('memberChannel_selectClanFocus_', '');
    const selectedValue = interaction.values[0];

    try {
      if (selectedValue === 'REMOVE_FOCUS') {
        // Remove clan focus
        await pool.query(
          `
          UPDATE member_channels
          SET clantag_focus = NULL, clan_name_focus = NULL
          WHERE guild_id = $1 AND channel_id = $2
          `,
          [parsed.guildId, channelId],
        );

        // Log focus removal (fire-and-forget)
        memberChannelService.logFocusChanged(
          interaction.client,
          parsed.guildId,
          channelId,
          interaction.user.id,
          undefined,
        );

        await interaction.editReply({
          content: '✅ Clan focus has been removed from this channel.',
          embeds: [],
          components: [],
        });
      } else {
        // Set new clan focus
        const clanRes = await pool.query(`SELECT clan_name FROM clans WHERE guild_id = $1 AND clantag = $2`, [
          parsed.guildId,
          selectedValue,
        ]);

        if (clanRes.rows.length === 0) {
          await interaction.editReply({
            content: '❌ Clan not found.',
            embeds: [],
            components: [],
          });
          return;
        }

        const clanName = clanRes.rows[0].clan_name;

        await pool.query(
          `
          UPDATE member_channels
          SET clantag_focus = $1, clan_name_focus = $2
          WHERE guild_id = $3 AND channel_id = $4
          `,
          [selectedValue, clanName, parsed.guildId, channelId],
        );

        // Log focus change (fire-and-forget)
        memberChannelService.logFocusChanged(interaction.client, parsed.guildId, channelId, interaction.user.id, {
          name: clanName,
          tag: selectedValue,
        });

        await interaction.editReply({
          content: `✅ Clan focus set to **${clanName}** (${selectedValue}). Run \`/check\` again to refresh.`,
          embeds: [],
          components: [],
        });
      }
    } catch (error) {
      console.error('Error updating clan focus:', error);
      await interaction.editReply({
        content: '❌ Failed to update clan focus.',
        embeds: [],
        components: [],
      });
    }
  }

  static async handlePingMembersButton(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    await interaction.deferReply({ ephemeral: true });
    console.log(parsed);

    const membersRes = await pool.query(
      `
      SELECT mc.clantag_focus, mc.clan_name_focus, mc.members, c.invites_enabled
      FROM member_channels mc
      JOIN clans c ON mc.clantag_focus = c.clantag AND mc.guild_id = c.guild_id
      WHERE mc.guild_id = $1 AND mc.channel_id = $2
      `,
      [parsed.guildId, interaction.channelId],
    );

    if (!membersRes.rows[0]?.clan_name_focus || !membersRes.rows[0]?.clantag_focus) {
      await interaction.editReply({
        content: '❌ This member channel does not have a clan focus set. Please set a clan focus first.',
      });
      return;
    }

    if (membersRes.rowCount === 0) {
      await interaction.editReply({ content: '❌ No member channel found for this channel.' });
      return;
    }

    const clanNameFocus = membersRes.rows[0].clan_name_focus;
    const clantagFocus = membersRes.rows[0].clantag_focus;

    // Check if there's an active invite link
    const activeInvite = await clanInviteService.getActiveInvite(parsed.guildId, clantagFocus);
    if (!activeInvite) {
      const embed = new EmbedBuilder()
        .setDescription(
          `❌ There is currently no active clan invite link for **${clanNameFocus}**.\nPlease generate one using \`/update-clan-invite\``,
        )
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const invitesEnabled = membersRes.rows[0].invites_enabled;

    if (!invitesEnabled) {
      const embed = new EmbedBuilder()
        .setDescription(`❌ Invites are currently disabled for **${clanNameFocus}**.`)
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const memberList = membersRes.rows[0].members;

    // Fetch clan info
    const clanInfo = await CR_API.getClan(clantagFocus);
    if ('error' in clanInfo) {
      const fetchError = clanInfo as FetchError;
      const embed =
        fetchError.embed ?? new EmbedBuilder().setDescription('❌ Failed to fetch clan information.').setColor('Red');
      await interaction.editReply({
        embeds: [embed],
      });
      return;
    }
    if (!clanInfo) {
      await interaction.editReply({ content: '❌ Failed to fetch clan info from API.' });
      return;
    }

    // Create a Set of clan member tags for fast lookup
    const clanMemberTags = new Set(clanInfo.memberList.map((m) => m.tag));

    // Track missing accounts and the Discord IDs that need to be pinged
    const missingAccounts: Array<{ name: string; tag: string; discordId: string; joiningLate: boolean }> = [];
    const missingAnyTypeUsers: Array<{ discordId: string; current: number; required: number }> = [];
    const discordIdsToPing = new Set<string>();

    for (const member of memberList) {
      const { discordId, players, joiningLate } = member;

      // Only skip pinging late joiners during safe period (Monday 2:30 AM to Wednesday 2:30 PM MST)
      const shouldSkipPing = joiningLate && !shouldPingLateJoiners();

      if (Array.isArray(players)) {
        // Check each specific account
        for (const player of players) {
          if (!clanMemberTags.has(player.tag)) {
            missingAccounts.push({
              name: player.name,
              tag: player.tag,
              discordId,
              joiningLate: joiningLate || false,
            });
            if (!shouldSkipPing) {
              discordIdsToPing.add(discordId);
            }
          }
        }
      } else if (players.type === 'any') {
        // Check if they meet the 'any X accounts' requirement
        const userAccountsResult = await pool.query(
          `SELECT playertag FROM user_playertags WHERE guild_id = $1 AND discord_id = $2`,
          [parsed.guildId, discordId],
        );

        const userTags = userAccountsResult.rows.map((r) => r.playertag);
        const accountsInClan = userTags.filter((tag) => clanMemberTags.has(tag));

        // If they don't meet the requirement, ping them
        if (accountsInClan.length < players.count) {
          missingAnyTypeUsers.push({
            discordId,
            current: accountsInClan.length,
            required: players.count,
          });
          if (!shouldSkipPing) {
            discordIdsToPing.add(discordId);
          }
        }
      }
    }

    // Check if everyone is actually in the clan (no missing accounts at all)
    if (missingAccounts.length === 0 && missingAnyTypeUsers.length === 0) {
      await interaction.editReply({ content: '✅ All members are in the clan!' });
      return;
    }

    // Build the embed
    const embedLines: string[] = [];

    if (missingAccounts.length > 0) {
      embedLines.push('**Accounts missing:**');
      missingAccounts.forEach((acc) => {
        const emoji = acc.joiningLate ? '🕐 ' : '';
        const encodedTag = encodeURIComponent(acc.tag);
        const link = `https://royaleapi.com/player/${encodedTag}`;
        embedLines.push(`* [${acc.name}](${link}) ${emoji}`);
      });
    }

    if (missingAnyTypeUsers.length > 0) {
      if (embedLines.length > 0) embedLines.push(''); // Add spacing
      missingAnyTypeUsers.forEach((user) => {
        const needed = user.required - user.current;
        embedLines.push(
          `* <@${user.discordId}> - needs ${needed} more account${needed !== 1 ? 's' : ''} (${user.current}/${user.required})`,
        );
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`Missing Members - ${clanNameFocus}`)
      .setDescription(embedLines.join('\n'))
      .setColor('Orange');

    const joiningLateButton = new ButtonBuilder()
      .setCustomId(makeCustomId('b', 'memberChannel_joiningLate', parsed.guildId, { cooldown: 5 }))
      .setLabel('Joining Late')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🕐');

    // Build the ping message - only ping if there are people to ping
    let content: string;
    if (discordIdsToPing.size > 0) {
      const pings = Array.from(discordIdsToPing)
        .map((id) => `<@${id}>`)
        .join(', ');
      content = `Attention - Clan Movements for **${clanNameFocus}**: ${pings}.`;
    } else {
      // There are missing members but they're all joining late during safe period
      content = `**${clanNameFocus}** - Missing members`;
    }

    // Send to the channel (not ephemeral)
    await interaction.channel?.send({
      content,
      embeds: [embed],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(joiningLateButton)],
    });

    // Send invite to the current channel and track it
    const message = await clanInviteService.sendInviteToChannel(
      interaction.client,
      interaction.guildId!,
      interaction.channelId,
      clantagFocus,
      'Member Channel Ping',
      interaction.user.id,
    );

    if (message) {
      const confirmEmbed = new EmbedBuilder()
        .setDescription(`✅ Sent invite link for **${clanNameFocus}** below.`)
        .setColor(EmbedColor.SUCCESS);
      await interaction.editReply({ embeds: [confirmEmbed] });
      await pool.query(
        `
        UPDATE member_channels 
        SET last_ping = NOW()
        WHERE guild_id = $1 AND channel_id = $2
        `,
        [interaction.guildId, interaction.channelId],
      );
    } else {
      const errorEmbed = new EmbedBuilder().setDescription(`❌ Failed to send invite link.`).setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }

  static async handleJoiningLateButton(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    await interaction.deferReply({ ephemeral: true });

    // Fetch current members

    const result = await pool.query(
      `
      SELECT members from member_channels WHERE guild_id = $1 and channel_id = $2`,
      [parsed.guildId, interaction.channelId],
    );

    if (result.rowCount === 0) {
      await interaction.editReply({ content: '❌ No member channel found for this channel.' });
      return;
    }

    const members: MemberData[] = result.rows[0].members;
    const memberIndex = members.findIndex((m) => m.discordId === interaction.user.id);

    if (memberIndex === -1) {
      await interaction.editReply({ content: '❌ You are not listed as a member for this channel.' });
      return;
    }

    // Toggle joining late status
    members[memberIndex].joiningLate = !members[memberIndex].joiningLate;
    const isJoiningLate = members[memberIndex].joiningLate;

    // Update database
    await pool.query(`UPDATE member_channels SET members = $1 WHERE guild_id = $2 AND channel_id = $3`, [
      JSON.stringify(members),
      parsed.guildId,
      interaction.channelId,
    ]);

    const emoji = isJoiningLate ? '🕐' : '✅';
    const status = isJoiningLate ? 'joining late' : 'joining on time';
    await interaction.editReply({
      content: `${emoji} You are now marked as **${status}**.`,
    });
  }

  // ============================================================================
  // Helper method for initial channel creation
  // ============================================================================

  /**
   * Send initial member status message when channel is created
   * Only pings missing members (same behavior as Ping Members button)
   */
  private static async sendInitialMemberStatus(
    interaction: ButtonInteraction,
    channelId: string,
    guildId: string,
  ): Promise<void> {
    try {
      const channel = await interaction.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return;

      // Fetch member channel data
      const membersRes = await pool.query(
        `
        SELECT mc.clantag_focus, mc.clan_name_focus, mc.members, c.invites_enabled
        FROM member_channels mc
        JOIN clans c ON mc.clantag_focus = c.clantag AND mc.guild_id = c.guild_id
        WHERE mc.guild_id = $1 AND mc.channel_id = $2
        `,
        [guildId, channelId],
      );
      // TODO if no focus group, isnt sending a message?
      // Also handle 'All members are in 'clan'', just pings and no info.
      if (membersRes.rowCount === 0) return;

      const memberList = membersRes.rows[0].members;
      const clanNameFocus = membersRes.rows[0].clan_name_focus;
      const clantagFocus = membersRes.rows[0].clantag_focus;

      // Get all Discord IDs to ping everyone
      const allDiscordIds = memberList.map((m: { discordId: string }) => m.discordId);
      const allPings = allDiscordIds.map((id: string) => `<@${id}>`).join(', ');

      const joiningLateButton = new ButtonBuilder()
        .setCustomId(makeCustomId('b', 'memberChannel_joiningLate', guildId))
        .setLabel('Joining Late')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🕐');

      // If there's no clan focus, just ping everyone
      if (!clanNameFocus || !clantagFocus) {
        await channel.send({
          content: `${allPings} - Attention`,
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(joiningLateButton)],
        });
        return;
      }

      // Fetch clan info to check member status
      const clanInfo = await CR_API.getClan(clantagFocus);
      if ('error' in clanInfo || !clanInfo) {
        // If can't fetch clan info, just ping everyone
        await channel.send({
          content: `${allPings}\n\n⚠️ Unable to check clan status for **${clanNameFocus}** at this time.`,
        });
        return;
      }

      // Check if there's an active invite link
      const activeInvite = await clanInviteService.getActiveInvite(guildId, clantagFocus);

      // Create a Set of clan member tags for fast lookup
      const clanMemberTags = new Set(clanInfo.memberList.map((m) => m.tag));

      // Track missing accounts and the Discord IDs that need to be pinged
      const missingAccounts: Array<{ name: string; tag: string; discordId: string }> = [];
      const missingAnyTypeUsers: Array<{ discordId: string; current: number; required: number }> = [];
      const discordIdsToPing = new Set<string>();

      for (const member of memberList) {
        const { discordId, players } = member;

        if (Array.isArray(players)) {
          // Check each specific account
          for (const player of players) {
            if (!clanMemberTags.has(player.tag)) {
              missingAccounts.push({
                name: player.name,
                tag: player.tag,
                discordId,
              });
              discordIdsToPing.add(discordId);
            }
          }
        } else if (players.type === 'any') {
          // Check if they meet the 'any X accounts' requirement
          const userAccountsResult = await pool.query(
            `SELECT playertag FROM user_playertags WHERE guild_id = $1 AND discord_id = $2`,
            [guildId, discordId],
          );

          const userTags = userAccountsResult.rows.map((r) => r.playertag);
          const accountsInClan = userTags.filter((tag) => clanMemberTags.has(tag));

          // If they don't meet the requirement, ping them
          if (accountsInClan.length < players.count) {
            missingAnyTypeUsers.push({
              discordId,
              current: accountsInClan.length,
              required: players.count,
            });
            discordIdsToPing.add(discordId);
          }
        }
      }

      // If no one needs to be pinged - all members are already in clan
      if (discordIdsToPing.size === 0) {
        // Build an embed showing all members and their accounts
        let allMembersDescription = '✅ **All members are in the clan!**\n\n';

        for (const member of memberList) {
          const { discordId, players } = member;
          allMembersDescription += `**<@${discordId}>**\n`;

          if (Array.isArray(players)) {
            if (players.length === 0) {
              allMembersDescription += '* No accounts selected\n';
            } else {
              for (const player of players) {
                const encodedTag = encodeURIComponent(player.tag);
                const link = `https://royaleapi.com/player/${encodedTag}`;
                allMembersDescription += `* ✅ [${player.name}](${link})\n`;
              }
            }
          } else if (players.type === 'any') {
            allMembersDescription += `* ✅ Any ${players.count} account${players.count !== 1 ? 's' : ''} linked to you\n`;
          }
          allMembersDescription += '\n';
        }

        const allInClanEmbed = new EmbedBuilder()
          .setTitle(`Member Channel Created - ${clanNameFocus}`)
          .setDescription(allMembersDescription.trim())
          .setColor(EmbedColor.SUCCESS)
          .setTimestamp();

        await channel.send({
          content: allPings,
          embeds: [allInClanEmbed],
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(joiningLateButton)],
        });
        return;
      }

      // Build the embed for missing members
      const embedLines: string[] = [];

      if (missingAccounts.length > 0) {
        embedLines.push('**Accounts missing:**');
        missingAccounts.forEach((acc) => {
          const encodedTag = encodeURIComponent(acc.tag);
          const link = `https://royaleapi.com/player/${encodedTag}`;
          embedLines.push(`* [${acc.name}](${link})`);
        });
      }

      if (missingAnyTypeUsers.length > 0) {
        if (embedLines.length > 0) embedLines.push(''); // Add spacing
        missingAnyTypeUsers.forEach((user) => {
          const needed = user.required - user.current;
          embedLines.push(
            `* <@${user.discordId}> - needs ${needed} more account${needed !== 1 ? 's' : ''} (${user.current}/${user.required})`,
          );
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(`Missing Members - ${clanNameFocus}`)
        .setDescription(embedLines.join('\n'))
        .setColor('Orange');

      // Build the ping message for missing members
      const pings = Array.from(discordIdsToPing)
        .map((id) => `<@${id}>`)
        .join(', ');
      const content = `Attention - Clan Movements for **${clanNameFocus}**: ${pings}.`;

      // Send to the channel
      await channel.send({
        content,
        embeds: [embed],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(joiningLateButton)],
      });

      const invitesEnabled = membersRes.rows[0].invites_enabled;
      console.log(invitesEnabled);
      if (!invitesEnabled) {
        const embed = new EmbedBuilder()
          .setDescription(`⚠️ Invites are currently disabled for **${clanNameFocus}**.`)
          .setColor(EmbedColor.WARNING);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Send invite link if available
      if (activeInvite) {
        const message = await clanInviteService.sendInviteToChannel(
          interaction.client,
          guildId,
          channelId,
          clantagFocus,
          'Member Channel Ping',
          interaction.user.id,
        );

        if (!message) {
          console.error('[sendInitialMemberStatus] Failed to send invite link');
        }
      } else {
        const embed = new EmbedBuilder()
          .setDescription(
            `⚠️ There is currently no active clan invite link for **${clanNameFocus}**.\nPlease generate one using \`/update-clan-invite\``,
          )
          .setColor(EmbedColor.WARNING);
        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error('[sendInitialMemberStatus] Error:', error);
      // Don't throw - this is a nice-to-have feature
    }
  }

  /**
   * Notify newly added members in the channel
   */
  private static async notifyAddedMembers(
    guild: Guild,
    channelId: string,
    addedMembers: Array<{
      discordId: string;
      players: import('../../utils/memberChannelHelpers.js').PlayerInfo[] | { type: 'any'; count: number };
    }>,
  ): Promise<void> {
    try {
      const channel = await guild.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return;

      // Build ping string
      const pings = addedMembers.map((m) => `<@${m.discordId}>`).join(' ');

      // Build description with selected accounts
      let description = '**New members added to this channel:**\n\n';

      for (const member of addedMembers) {
        // const guildMember = await guild.members.fetch(member.discordId).catch(() => null);
        // const displayName = guildMember?.displayName || `<@${member.discordId}>`;
        const displayName = `<@${member.discordId}>`;

        description += `**${displayName}**\n`;

        // Handle different player selection types
        if (Array.isArray(member.players)) {
          if (member.players.length === 0) {
            description += '* No accounts selected\n';
          } else {
            for (const player of member.players) {
              description += `* ${player.name} (\`${player.tag}\`)\n`;
            }
          }
        } else if (member.players && typeof member.players === 'object' && 'type' in member.players) {
          // Handle "any X accounts" type
          const anyType = member.players as { type: string; count: number };
          description += `* Any ${anyType.count} account${anyType.count !== 1 ? 's' : ''} linked to you\n`;
        }
        description += '\n';
      }

      const embed = new EmbedBuilder().setDescription(description.trim()).setColor(EmbedColor.SUCCESS).setTimestamp();

      await channel.send({ content: pings, embeds: [embed] });
    } catch (error) {
      console.error('[notifyAddedMembers] Error:', error);
      // Don't throw - this is a nice-to-have feature
    }
  }

  static async handleDeleteChannelButton(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    await interaction.deferReply({ ephemeral: true });
    const result = await pool.query(
      `
      SELECT mc.channel_id, mc.current_delete_count, mc.delete_confirmed_by, mc.members, mc.clantag_focus, mc.clan_name_focus, mc.last_ping,
             COALESCE(mcs.delete_confirm_count, 2) as delete_confirm_count, mc.is_locked
      FROM member_channels mc
      LEFT JOIN member_channel_settings mcs ON mc.guild_id = mcs.guild_id
      WHERE mc.guild_id = $1 AND mc.channel_id = $2`,
      [interaction.guildId, interaction.channelId],
    );

    if (result.rowCount === 0) {
      await interaction.editReply({ content: '❌ No member channel found for this channel.' });
      return;
    }

    if (result.rows[0].is_locked) {
      await interaction.editReply({ content: '❌ This channel is locked and cannot be deleted.' });
      return;
    }

    const deleteConfirmCount = result.rows[0].delete_confirm_count || 2;
    const confirmedBy: string[] = result.rows[0].delete_confirmed_by || [];
    const currentUserId = interaction.user.id;

    // Check if user has already confirmed (only enforce if delete_confirm_count > 1)
    if (deleteConfirmCount > 1 && confirmedBy.includes(currentUserId)) {
      const remainingConfirmations = deleteConfirmCount - confirmedBy.length;
      await interaction.editReply({
        content: `❌ You have already confirmed this deletion. ${remainingConfirmations} more confirmation(s) needed from others.`,
      });
      return;
    }

    // Add current user to confirmed list
    const newConfirmedBy = [...confirmedBy, currentUserId];
    const newDeleteCount = newConfirmedBy.length;

    // Update delete count and confirmed by list
    await pool.query(
      `
      UPDATE member_channels
      SET current_delete_count = $3, delete_confirmed_by = $4
      WHERE guild_id = $1 AND channel_id = $2
      `,
      [interaction.guildId, interaction.channelId, newDeleteCount, newConfirmedBy],
    );

    // Check if we should delete the channel
    if (newDeleteCount >= deleteConfirmCount) {
      // Mark as deleted in database first
      try {
        // Get channel info before deletion
        const channel = interaction.channel;
        const channelName = channel && 'name' in channel ? channel.name : undefined;

        await pool.query(
          `UPDATE member_channels 
           SET is_deleted = true, deleted_at = NOW() 
           WHERE guild_id = $1 AND channel_id = $2`,
          [interaction.guildId, interaction.channelId],
        );

        // Log channel deletion (fire-and-forget)
        memberChannelService.logChannelDeleted(
          interaction.client,
          interaction.guildId!,
          interaction.channelId!,
          interaction.user.id,
          channelName ?? undefined,
        );

        await interaction.editReply('Deleting channel in 5 seconds...');

        // Delete the Discord channel after 5 seconds
        if (channel?.isTextBased() && 'delete' in channel) {
          setTimeout(async () => {
            try {
              await channel.delete();
            } catch (error) {
              console.error('[handleDeleteChannelButton] Error deleting channel:', error);
            }
          }, 5000);
        }
      } catch (error) {
        console.error('[handleDeleteChannelButton] Error marking channel for deletion:', error);
        await interaction.editReply({ content: '❌ Failed to delete channel.' });
      }
      return;
    }

    // Update the original /check message with new delete count
    const remainingConfirmations = deleteConfirmCount - newDeleteCount;

    // Calculate total accounts from members
    const totalMembers = result.rows[0].members.length;
    const totalAccounts = result.rows[0].members.reduce((sum: number, member: MemberData) => {
      if (Array.isArray(member.players)) {
        return sum + member.players.length;
      } else if (member.players && typeof member.players === 'object' && 'count' in member.players) {
        return sum + member.players.count;
      }
      return sum;
    }, 0);

    // Build list of users who confirmed
    const confirmedByList = newConfirmedBy.map((userId) => `<@${userId}>`).join(', ');

    // Rebuild the embed with delete count warning
    let embedDescription = '';
    if (result.rows[0].clantag_focus) {
      const clanData = await CR_API.getClan(result.rows[0].clantag_focus);
      if (!('error' in clanData)) {
        embedDescription =
          `**Clan:** ${result.rows[0].clan_name_focus} (${result.rows[0].clantag_focus})\n` +
          `**Clan Members:** ${clanData.members}/50\n` +
          `**Channel Members:** ${totalMembers}\n` +
          `**Accounts Selected:** ${totalAccounts}\n` +
          `**Last Ping:** ${result.rows[0].last_ping ? new Date(result.rows[0].last_ping).toLocaleString() : 'N/A'}\n\n` +
          `⚠️ **Delete confirmations: ${newDeleteCount}/${deleteConfirmCount}** (${remainingConfirmations} more needed)\n` +
          `-# Confirmed by: ${confirmedByList}`;
      }
    } else {
      embedDescription =
        `**Clan Focus:** None\n` +
        `**Channel Members:** ${totalMembers}\n` +
        `**Accounts Selected:** ${totalAccounts}\n` +
        `**Last Ping:** ${result.rows[0].last_ping ? new Date(result.rows[0].last_ping).toLocaleString() : 'N/A'}\n\n` +
        `⚠️ **Delete confirmations: ${newDeleteCount}/${deleteConfirmCount}** (${remainingConfirmations} more needed)\n` +
        `-# Confirmed by: ${confirmedByList}`;
    }

    const updatedEmbed = new EmbedBuilder()
      .setTitle(result.rows[0].clan_name_focus ? `${result.rows[0].clan_name_focus} Info` : 'Member Channel Info')
      .setDescription(embedDescription)
      .setColor('Orange');

    await interaction.editReply({
      content: `⚠️ Delete confirmation ${newDeleteCount}/${deleteConfirmCount} recorded. ${remainingConfirmations} more confirmation(s) needed from other members.`,
    });
  }

  static async handleLockChannelButton(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    // Defer immediately to prevent timeout
    await interaction.deferUpdate();

    // Ensure channel is a guild text channel, not a DM
    if (!interaction.channel || interaction.channel.type === ChannelType.DM || !interaction.guild) {
      return;
    }

    const lockRes = await pool.query(
      `
      SELECT is_locked FROM member_channels WHERE guild_id = $1 AND channel_id = $2
    `,
      [parsed.guildId, interaction.channelId],
    );

    const isLocked = lockRes.rows[0].is_locked;
    const newLockStatus = !isLocked;

    await pool.query(
      `
      UPDATE member_channels
      SET is_locked = $3
      WHERE guild_id = $1 and channel_id = $2
    `,
      [parsed.guildId, interaction.channelId, newLockStatus],
    );

    // Re-fetch the channel data to rebuild the embed with updated lock status
    const validChannelSQL = await pool.query(
      `
      SELECT mc.channel_id, mc.clantag_focus, mc.clan_name_focus, mc.members, mc.last_ping, mc.current_delete_count, mc.delete_confirmed_by,
             COALESCE(mcs.delete_confirm_count, 2) as delete_confirm_count, mc.is_locked
      FROM member_channels mc
      LEFT JOIN member_channel_settings mcs ON mc.guild_id = mcs.guild_id
      WHERE mc.guild_id = $1 AND mc.channel_id = $2
      `,
      [parsed.guildId, interaction.channelId],
    );
    const res = validChannelSQL.rows[0];

    if (!res || !interaction.guild) {
      return;
    }

    const { embed, components } = await buildMemberChannelCheckUI(res, interaction.guild.id);

    // Update channel name to add/remove lock icon (do this after building UI to avoid delays)
    if ('setName' in interaction.channel) {
      const currentName = interaction.channel.name;
      let newChannelName: string;

      if (newLockStatus) {
        // Locking: Add lock icon if not already present
        newChannelName = currentName.startsWith('🔒') ? currentName : `🔒${currentName}`;
      } else {
        // Unlocking: Remove lock icon if present
        newChannelName = currentName.startsWith('🔒') ? currentName.slice(1) : currentName;
      }

      // Don't await this - let it happen in the background
      // Note: Discord rate limits channel renames to 2 per 10 minutes
      if (currentName !== newChannelName) {
        interaction.channel.setName(newChannelName).catch(() => {
          // Silently fail - rate limits are expected
        });
      }
    }

    // Use interaction.editReply() after deferUpdate()
    await interaction.editReply({
      embeds: [embed],
      components,
    });
  }

  static async handleRenameChannelButton(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    const modal = new ModalBuilder()
      .setCustomId(makeCustomId('m', 'memberChannel_renameChannelModal', interaction.guildId!, { cooldown: 5 }))
      .setTitle('Rename Member Channel')
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('New Channel Name')
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId('renameChannelInput')
              .setStyle(TextInputStyle.Short)
              .setMinLength(1)
              .setMaxLength(30),
          ),
      );
    await interaction.showModal(modal);
  }

  // ============================================================================
  // Main router methods for interaction dispatcher
  // ============================================================================

  /**
   * [ROUTER] Route button interactions to appropriate handlers
   */
  static async handleButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action } = parsed;
    logger.info(`Button interaction: ${action}`);
    if (action === 'memberChannel_create') {
      return this.handleConfirmButton(interaction, parsed);
    } else if (action.startsWith('memberChannel_any_')) {
      return this.handleAnyAccountsButton(interaction, parsed);
    } else if (action.startsWith('memberChannel_confirm_')) {
      return this.handleConfirmButton(interaction, parsed);
    } else if (action.startsWith('memberChannel_cancel_')) {
      return this.handleCancelButton(interaction, parsed);
    } else if (action.startsWith(`memberChannel_continue_`)) {
      return this.handleContinueButton(interaction, parsed);
    }

    if (action.startsWith('memberChannel_checkMembers')) {
      return this.handleCheckMembersButton(interaction, parsed);
    } else if (action.startsWith('memberChannel_changeFocus')) {
      return this.handleChangeFocusButton(interaction, parsed);
    } else if (action.startsWith('memberChannel_pingMembers')) {
      return this.handlePingMembersButton(interaction, parsed);
    } else if (action.startsWith('memberChannel_addMembers')) {
      return this.handleAddMembersButton(interaction, parsed);
    } else if (action.startsWith('memberChannel_removeMember')) {
      return this.handleRemoveMembersButton(interaction, parsed);
    } else if (action.startsWith('memberChannel_deleteChannel')) {
      return this.handleDeleteChannelButton(interaction, parsed);
    } else if (action.startsWith('memberChannel_lockChannel')) {
      return this.handleLockChannelButton(interaction, parsed);
    } else if (action.startsWith('memberChannel_renameChannel')) {
      return this.handleRenameChannelButton(interaction, parsed);
    }

    if (action.startsWith('memberChannel_joiningLate')) {
      return this.handleJoiningLateButton(interaction, parsed);
    }

    // Fallback for unhandled actions
    logger.warn(`Unhandled member channel button action: ${action}`);
    await interaction.reply({
      content: '❌ This action is not recognized. Please try again or contact an administrator.',
      ephemeral: true,
    });
  }
  /**
   * [ROUTER] Route modal interactions to appropriate handlers
   */
  static async handleModal(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action } = parsed;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (action === 'memberChannel_create') {
      return this.handleStartCreateChannelModal(interaction, parsed);
    } else if (action.startsWith('memberChannel_anyCount_')) {
      return this.handleAnyAccountsModal(interaction, parsed);
    } else if (action === 'memberChannel_addMemberModal') {
      return this.handleAddMemberModal(interaction, parsed);
    } else if (action === 'memberChannel_removeMemberModal') {
      return this.handleRemoveMemberModal(interaction, parsed);
    } else if (action === 'memberChannel_renameChannelModal') {
      return this.handleRenameChannelModal(interaction, parsed);
    }
  }

  /**
   * [ROUTER] Route select menu interactions to appropriate handlers
   */
  static async handleSelectMenu(interaction: StringSelectMenuInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action } = parsed;

    if (action.startsWith('memberChannel_accounts_')) {
      return this.handleAccountSelection(interaction, parsed);
    } else if (action.startsWith('memberChannel_selectClanFocus_')) {
      return this.handleSelectClanFocus(interaction, parsed);
    }
  }
}

/**
 * Check if we should ping "joining late" members
 * War starts Thursday ~2:30 AM MST (UTC-7)
 * Returns false during safe period: Monday 2:30 AM to Wednesday 2:30 PM MST (don't ping late joiners)
 * Returns true otherwise: Wednesday 2:30 PM MST onwards (ping everyone including late joiners)
 */
function shouldPingLateJoiners(): boolean {
  const now = new Date();

  // Convert to MST (UTC-7) by subtracting 7 hours from UTC
  const mstTime = new Date(now.getTime() - 7 * 60 * 60 * 1000);

  // Get current day of week in MST (0 = Sunday, 1 = Monday, 3 = Wednesday, 4 = Thursday)
  const currentDay = mstTime.getUTCDay();
  const currentHour = mstTime.getUTCHours();
  const currentMinute = mstTime.getUTCMinutes();

  // Convert to total minutes since start of week for easier comparison
  const currentTimeInMinutes = currentDay * 24 * 60 + currentHour * 60 + currentMinute;

  // Monday 2:30 AM = day 1, hour 2, minute 30 = 1 * 1440 + 2 * 60 + 30 = 1590 minutes
  const mondayStart = 1 * 24 * 60 + 2 * 60 + 30; // 1590 minutes

  // Wednesday 2:30 PM = day 3, hour 14, minute 30 = 3 * 1440 + 14 * 60 + 30 = 5190 minutes
  const wednesdayEnd = 3 * 24 * 60 + 14 * 60 + 30; // 5190 minutes

  // If we're between Monday 2:30 AM and Wednesday 2:30 PM, it's the safe period
  if (currentTimeInMinutes >= mondayStart && currentTimeInMinutes < wednesdayEnd) {
    return false; // Safe period: don't ping joining late members
  }

  // Otherwise, we're in war prep or war time (Wednesday 2:30 PM onwards)
  return true; // War time: ping everyone including joining late members
}
