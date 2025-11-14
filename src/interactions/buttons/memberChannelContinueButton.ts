import { ButtonInteraction, MessageFlags } from 'discord.js';
import { memberChannelCache } from '../../cache/memberChannelCache.js';
import { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { ButtonHandler } from '../handleButtonInteraction.js';
import { showAccountSelectionForUser } from '../modals/memberChannelCreate.js';
import { showFinalConfirmation } from '../selectMenus/memberChannelSelect.js';

const memberChannelContinueButton: ButtonHandler = {
  customId: 'member_channel_continue',
  async execute(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    const { extra } = parsed;
    const currentUserIndex = parseInt(extra[0], 10);

    const data = memberChannelCache.get(interaction.message.interactionMetadata?.id || '');
    if (!data) {
      await interaction.reply({ content: '❌ Session expired. Please try again.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Verify this is the correct user
    if (interaction.user.id !== data.creatorId) {
      await interaction.reply({
        content: '❌ Only the person creating the channel can make selections.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Use the pre-selected accounts (or the ones from the select menu if they changed it)
    const currentDiscordId = data.multipleAccountUserIds[currentUserIndex];

    // If no selection was made yet (user clicked continue with pre-selected), use pre-selected
    if (!data.selectedAccounts.has(currentDiscordId)) {
      // Get pre-selected accounts from the data
      const preSelectedTags = data.selectedAccounts.get(currentDiscordId) || [];
      if (preSelectedTags.length > 0) {
        // Already have pre-selected, they're good
      } else {
        // No pre-selected accounts found, should not happen but fallback
        await interaction.reply({
          content: '❌ Please select at least one account from the menu.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    // Move to next user or finish
    data.currentUserIndex = currentUserIndex + 1;

    if (data.currentUserIndex >= data.multipleAccountUserIds.length) {
      // All users processed, show final confirmation
      await showFinalConfirmation(interaction);
    } else {
      // Show next user's account selection
      await showAccountSelectionForUser(interaction, data.currentUserIndex);
    }
  },
};

export default memberChannelContinueButton;
