import {
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  ButtonInteraction,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonStyle,
} from 'discord.js';
import { memberChannelCache } from '../../cache/memberChannelCache.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { showAccountSelectionForUser, getCombinedFinalAccountsWithNames } from '../modals/memberChannelCreate.js';
import { SelectMenuHandler } from '../handleSelectMenuInteraction.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { ButtonBuilder } from 'discord.js';
import { makeCustomId } from '../../utils/customId.js';

const memberChannelSelect: SelectMenuHandler = {
  customId: 'member_channel_select',
  async execute(interaction: StringSelectMenuInteraction) {
    if (!interaction || !interaction.guild) return;
    const data = memberChannelCache.get(interaction.message.interactionMetadata?.id || '');
    if (!data) {
      await interaction.reply({ content: '❌ Session expired. Please try again.', flags: MessageFlags.Ephemeral });
      return;
    }

    // const allowed = await checkPerms(interaction, interaction.guild.id, 'select menu', 'either', );
    // if (!allowed) return; // no perms

    // Verify this is the correct user
    if (interaction.user.id !== data.creatorId) {
      await interaction.reply({
        content: '❌ Only the person creating the channel can make selections.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Store the selected playertags for current user
    const currentDiscordId = data.multipleAccountUserIds[data.currentUserIndex];
    data.selectedAccounts.set(currentDiscordId, interaction.values);

    // Move to next user or finish
    data.currentUserIndex++;

    if (data.currentUserIndex >= data.multipleAccountUserIds.length) {
      // All users processed, show final confirmation
      await showFinalConfirmation(interaction);
    } else {
      // Show next user's account selection
      await showAccountSelectionForUser(interaction, data.currentUserIndex);
    }
  },
};

// async function showAccountSelectionForUser(interaction: StringSelectMenuInteraction, userIndex: number) {
//   // Similar to the function in memberChannelCreate.ts but for select menu interactions
//   // TODO: Implement this or refactor to share code
// }

export async function showFinalConfirmation(
  interaction: StringSelectMenuInteraction | ModalSubmitInteraction | ButtonInteraction
) {
  const data = memberChannelCache.get(
    interaction instanceof ModalSubmitInteraction ? interaction.id : interaction.message.interactionMetadata?.id || ''
  );
  if (!data) {
    if (interaction instanceof ModalSubmitInteraction) {
      await interaction.editReply({
        content: '❌ Session expired. Please try again.',
        embeds: [],
        components: [],
      });
    } else {
      await interaction.update({
        content: '❌ Session expired. Please try again.',
        embeds: [],
        components: [],
      });
    }
    return;
  }

  // Use the helper function to combine all accounts with names
  const allFinalAccounts = await getCombinedFinalAccountsWithNames(data);

  // Create summary for display
  const totalUsers = allFinalAccounts.size;
  const totalAccounts = Array.from(allFinalAccounts.values()).reduce((sum, players) => sum + players.length, 0);

  console.log('=== FINAL CHANNEL MEMBER SUMMARY ===');
  console.log(`Channel Name: ${data.channelName}`);
  console.log(`Total Discord Users: ${totalUsers}`);
  console.log(`Total Player Accounts: ${totalAccounts}`);
  console.log('Final Account Mapping:');

  // Sort users by their first player's name for consistent display
  const sortedUsers = Array.from(allFinalAccounts.entries()).sort((a, b) => {
    const aFirstName = a[1][0]?.name || '';
    const bFirstName = b[1][0]?.name || '';
    return aFirstName.localeCompare(bFirstName);
  });

  sortedUsers.forEach(([discordId, players]) => {
    // Players within each user are already sorted by name from getCombinedFinalAccountsWithNames
    const playerInfo = players.map((p) => `${p.name} (${p.tag})`).join(', ');
    console.log(`  <@${discordId}>: ${playerInfo}`);
  });

  // Store the final combined data for channel creation
  data.finalAccountSelection = allFinalAccounts;

  // Create a formatted list of members for display
  const membersList = sortedUsers
    .map(([discordId, players]) => {
      const playerNames = players.map((p) => p.name).join(', ');
      return `* <@${discordId}>: ${playerNames}`;
    })
    .join('\n');

  const responseEmbed = new EmbedBuilder()
    .setTitle('✅ Account Selection Complete!')
    .setDescription(
      `**Channel Name:** *${data.channelName}*\n**${totalUsers} Users** with **${totalAccounts} Player Accounts**`
    )
    .addFields({ name: 'Clan Focus', value: data.clanNameFocus ? data.clanNameFocus : 'None', inline: true })
    .addFields({ name: 'Members', value: membersList })
    .setColor(EmbedColor.SUCCESS);

  const confirmButton = new ButtonBuilder()
    .setCustomId(
      makeCustomId('b', 'member_channel', interaction.guild?.id || '', {
        ownerId: data.creatorId,
        cooldown: 5,
        extra: ['confirm'],
      })
    )
    .setLabel('Confirm Creation')
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId(
      makeCustomId('b', 'member_channel', interaction.guild?.id || '', {
        ownerId: data.creatorId,
        cooldown: 5,
        extra: ['cancel'],
      })
    )
    .setLabel('Cancel Creation')
    .setStyle(ButtonStyle.Danger);

  const responseData = {
    embeds: [responseEmbed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton)],
  };

  if (interaction instanceof ModalSubmitInteraction) {
    await interaction.editReply(responseData);
  } else {
    await interaction.update(responseData);
  }
}

export default memberChannelSelect;
