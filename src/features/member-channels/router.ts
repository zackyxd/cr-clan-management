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
} from 'discord.js';
import { memberChannelService } from './service.js';
import type { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { makeCustomId } from '../../utils/customId.js';
import { pool } from '../../db.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { CR_API, FetchError } from '../../api/CR_API.js';

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
      console.error('[handleStartCreateChannelModal] Error:', error);
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
          `• Use the dropdown to select specific accounts\n` +
          `• Click "Any X Accounts" to specify a count\n` +
          `• Click "Continue" to skip without selecting any`,
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
      if (interaction instanceof ModalSubmitInteraction) {
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
      } else {
        await interaction.editReply({
          content: `❌ Failed to add members: ${result.error}`,
          components: [],
        });
      }
    } else {
      // Creating new channel
      const result = await memberChannelService.createChannel(sessionId, interaction.guild);

      if (result.success) {
        await interaction.editReply({
          content: '✅ Member channel created successfully!',
          embeds: [],
          components: [],
        });
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
  static async handleAddMembersButton(interaction: ButtonInteraction, _parsed: ParsedCustomId) {
    const modal = new ModalBuilder()
      .setCustomId(makeCustomId('m', 'memberChannel_addMemberModal', interaction.guildId!))
      .setTitle('Add Members to Channel')
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
            .setLabel('Discord IDs or @mentions (space separated)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('123456789012345678 @user1 @user2')
            .setRequired(false),
        ),
      );

    await interaction.showModal(modal);
  }

  /**
   * Handle modal submission for adding members
   */
  static async handleAddMemberModal(interaction: ModalSubmitInteraction, parsed: ParsedCustomId) {
    // await interaction.deferReply({ ephemeral: true });

    const playertags = interaction.fields.getTextInputValue('addMemberPlayertagsInput');
    const discordIds = interaction.fields.getTextInputValue('addMemberDiscordIdsInput');

    if (!playertags.trim() && !discordIds.trim()) {
      await interaction.editReply({ content: '❌ Please provide at least one player tag or Discord ID.' });
      return;
    }

    try {
      const sessionId = await memberChannelService.startAddingMembers(
        parsed.guildId,
        interaction.channelId!,
        interaction.user.id,
        { playertags, discordIds },
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
      const { discordId, players } = member;

      if (Array.isArray(players)) {
        // Specific accounts - show player names
        for (const player of players) {
          const isInClan = clanMemberTags.has(player.tag);
          if (isInClan) {
            statusLines.push(`✅ ${player.name}`);
          } else {
            statusLines.push(`❌ ${player.name}`);
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
          statusLines.push(`✅ <@${discordId}> - ${accountsInClan.length}/${players.count} accounts`);
        } else {
          statusLines.push(`❌ <@${discordId}> - ${accountsInClan.length}/${players.count} accounts`);
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
      SELECT clantag_focus, clan_name_focus, members
      FROM member_channels
      WHERE guild_id = $1 AND channel_id = $2
      `,
      [parsed.guildId, interaction.channelId],
    );

    if (membersRes.rowCount === 0) {
      await interaction.editReply({ content: '❌ No member channel found for this channel.' });
      return;
    }

    if (!membersRes.rows[0].clan_name_focus || !membersRes.rows[0].clantag_focus) {
      await interaction.editReply({
        content: '❌ This member channel does not have a clan focus set. Please set a clan focus first.',
      });
      return;
    }

    const memberList = membersRes.rows[0].members;
    const clanNameFocus = membersRes.rows[0].clan_name_focus;
    const clantagFocus = membersRes.rows[0].clantag_focus;

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
          discordIdsToPing.add(discordId);
        }
      }
    }

    // If no one needs to be pinged
    if (discordIdsToPing.size === 0) {
      await interaction.editReply({ content: '✅ All members are in the clan!' });
      return;
    }

    // Build the embed
    const embedLines: string[] = [];

    if (missingAccounts.length > 0) {
      embedLines.push('**Accounts missing:**');
      missingAccounts.forEach((acc) => {
        const encodedTag = encodeURIComponent(acc.tag);
        const link = `https://royaleapi.com/player/${encodedTag}`;
        embedLines.push(`• [${acc.name}](${link})`);
      });
    }

    if (missingAnyTypeUsers.length > 0) {
      if (embedLines.length > 0) embedLines.push(''); // Add spacing
      embedLines.push('**Members needing more accounts:**');
      missingAnyTypeUsers.forEach((user) => {
        const needed = user.required - user.current;
        embedLines.push(
          `• <@${user.discordId}> - needs ${needed} more account${needed !== 1 ? 's' : ''} (${user.current}/${user.required})`,
        );
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`Missing Members - ${clanNameFocus}`)
      .setDescription(embedLines.join('\n'))
      .setColor('Orange');

    // Build the ping message
    const pings = Array.from(discordIdsToPing)
      .map((id) => `<@${id}>`)
      .join(', ');
    const content = `${pings} You still need to join **${clanNameFocus}**.`;

    // Send to the channel (not ephemeral)
    await interaction.channel?.send({
      content,
      embeds: [embed],
    });

    // Confirm to the user who triggered it
    await interaction.editReply({ content: '✅ Ping sent!' });
  }

  // ============================================================================
  // Main router methods for interaction dispatcher
  // ============================================================================

  /**
   * [ROUTER] Route button interactions to appropriate handlers
   */
  static async handleButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action } = parsed;

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
    }
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
