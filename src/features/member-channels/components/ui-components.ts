import {
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { EmbedColor } from '../../../types/EmbedUtil.js';
import { makeCustomId } from '../../../utils/customId.js';
import type { Player } from '../../../api/CR_API.js';
import type { AccountSelectionContext } from '../types.js';

/**
 * Creates the account selection embed for a user
 */
export function createAccountSelectionEmbed(context: AccountSelectionContext, players: Player[]): EmbedBuilder {
  const playerDescriptions = players
    .map((player) => `## [${player.name}](<https://royaleapi.com/player/${encodeURIComponent(player.tag)}>)`)
    .join('\n');

  return new EmbedBuilder()
    .setTitle(`Account Selection - User ${(context.userIndex ?? 0) + 1} of ${context.totalUsers ?? 1}`)
    .setDescription(
      `**<@${context.discordId}> has multiple accounts linked.\nSelect which accounts you want to add:**\n${playerDescriptions}`
    )
    .setColor(EmbedColor.WARNING)
    .setFooter({
      text: `Step ${(context.userIndex ?? 0) + 1}/${context.totalUsers ?? 1} • Select accounts or use "any X accounts"`,
    });
}

/**
 * Creates the account selection dropdown menu
 */
export function createAccountSelectMenu(
  players: Player[],
  guildId: string,
  sessionId: string,
  creatorId: string
): StringSelectMenuBuilder {
  const select = new StringSelectMenuBuilder()
    .setCustomId(
      makeCustomId('s', 'member_channel_account_select', guildId, {
        ownerId: creatorId,
        extra: [sessionId],
      })
    )
    .setPlaceholder('Select specific accounts')
    .setMinValues(1)
    .setMaxValues(players.length);

  players.forEach((player) => {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(player.name)
      .setDescription(`${player.tag} • Level ${player.expLevel}`)
      .setValue(player.tag);
    select.addOptions(option);
  });

  return select;
}

/**
 * Creates the "any accounts" and continue buttons
 */
export function createAccountActionButtons(
  guildId: string,
  sessionId: string,
  creatorId: string,
  userIndex: number
): ActionRowBuilder<ButtonBuilder> {
  const anyAccountButton = new ButtonBuilder()
    .setCustomId(
      makeCustomId('b', 'member_channel_any_account', guildId, {
        ownerId: creatorId,
        extra: [userIndex.toString(), sessionId],
      })
    )
    .setLabel('Use any account(s)')
    .setStyle(ButtonStyle.Primary);

  const continueButton = new ButtonBuilder()
    .setCustomId(
      makeCustomId('b', 'member_channel_continue', guildId, {
        ownerId: creatorId,
        extra: [userIndex.toString(), sessionId],
      })
    )
    .setLabel('Continue with Selected')
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(continueButton, anyAccountButton);
}

/**
 * Creates the final confirmation embed
 */
export function createConfirmationEmbed(
  channelName: string,
  clanNameFocus: string | null,
  totalUsers: number,
  totalAccounts: number,
  membersList: string
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('✅ Account Selection Complete!')
    .setDescription(
      `**Channel Name:** *${channelName}*\n**${totalUsers} Users** with **${totalAccounts} Player Accounts**`
    )
    .addFields(
      { name: 'Clan Focus', value: clanNameFocus || 'None', inline: true },
      { name: 'Members', value: membersList }
    )
    .setColor(EmbedColor.SUCCESS);
}

/**
 * Creates the confirmation action buttons
 */
export function createConfirmationButtons(
  guildId: string,
  sessionId: string,
  creatorId: string
): ActionRowBuilder<ButtonBuilder> {
  const confirmButton = new ButtonBuilder()
    .setCustomId(
      makeCustomId('b', 'member_channel_create', guildId, {
        ownerId: creatorId,
        cooldown: 5,
        extra: ['confirm', sessionId],
      })
    )
    .setLabel('Create Channel')
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId(
      makeCustomId('b', 'member_channel_create', guildId, {
        ownerId: creatorId,
        cooldown: 5,
        extra: ['cancel', sessionId],
      })
    )
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Danger);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);
}

/**
 * Creates the modal for selecting any account count
 */
export function createAnyAccountModal(
  guildId: string,
  maxAccounts: number,
  sessionId?: string,
  creatorId?: string
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(
      makeCustomId('m', 'any_account_count_modal', guildId, {
        ownerId: creatorId,
        extra: sessionId ? [sessionId] : [],
      })
    )
    .setTitle('Select Account Count');

  const textInput = new TextInputBuilder()
    .setCustomId('input')
    .setLabel(`How many accounts? (1-${maxAccounts})`)
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(2)
    .setRequired(true)
    .setPlaceholder('e.g., 1, 2, or 3');

  const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(textInput);
  modal.addComponents(firstActionRow);

  return modal;
}
