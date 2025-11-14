import {
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { ModalHandler } from '../../types/Handlers.js';
import { CR_API, FetchError, isFetchError, Player, PlayerResult } from '../../api/CR_API.js';
import { buildGetLinkedDiscordIds, buildGetLinkedPlayertags } from '../../sql_queries/users.js';
import { pool } from '../../db.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { memberChannelCache, cleanupMemberChannelCache } from '../../cache/memberChannelCache.js';
import type { MemberChannelData, PlayerInfo } from '../../cache/memberChannelCache.js';
import { makeCustomId } from '../../utils/customId.js';
import { showFinalConfirmation } from '../selectMenus/memberChannelSelect.js';

const createMemberChannelIndentifier: ModalHandler = {
  customId: 'create_member_channel',
  async execute(interaction, parsed) {
    const { guildId, action, extra } = parsed;
    console.log(guildId, action, extra);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channelName = interaction.fields.getTextInputValue('channel_name_input');
    const playertags = interaction.fields.getTextInputValue('playertags_input');
    const discordIds = interaction.fields.getTextInputValue('discord_ids_input');

    console.log('Creating member channel with the following details:');
    console.log('Channel Name:', channelName);
    console.log('Playertags:', playertags);
    console.log('Discord IDs:', discordIds);

    // Separate playertags and discord Ids into arrays (removes duplicates)
    const playertagArray = parsePlayertags(playertags);
    const discordIdArray = parseDiscordIds(discordIds);

    const validPlayers = await fetchValidPlayers(playertagArray);
    const validPlayertags = validPlayers.map((player) => player.tag);

    // console.log(`Valid players count: ${validPlayers.length} out of ${playertagArray.length}`);

    const resTags = await getDiscordIdsFromPlayertags(guildId, validPlayertags);
    const resIds = await getPlayertagsFromDiscordIds(guildId, discordIdArray);

    // const allPlayertagDiscordPairs = [...resTags, ...resIds];
    // const discordIdToPlayertags = groupPlayertagsByDiscordId(allPlayertagDiscordPairs);

    // Simplified Logic:
    // 1. Separate accounts from playertags (explicitly chosen) vs Discord IDs (need selection)
    // 2. Only ask for selection when Discord IDs have 2+ linked accounts

    // Accounts from playertags input (these are explicitly chosen, never ask for selection)
    const accountsFromPlayertags = new Map<string, string[]>();
    resTags.forEach(({ discord_id, playertag }) => {
      if (!accountsFromPlayertags.has(discord_id)) {
        accountsFromPlayertags.set(discord_id, []);
      }
      accountsFromPlayertags.get(discord_id)!.push(playertag);
    });

    // Accounts from Discord ID input (might need selection if 2+ accounts)
    const accountsFromDiscordIds = new Map<string, string[]>();
    resIds.forEach(({ discord_id, playertag }) => {
      if (!accountsFromDiscordIds.has(discord_id)) {
        accountsFromDiscordIds.set(discord_id, []);
      }
      accountsFromDiscordIds.get(discord_id)!.push(playertag);
    });

    // Build final single/multiple account users
    const finalSingleAccountUsers = new Map<string, string>();
    const finalMultipleAccountUsers = new Map<string, string[]>();
    const preSelectedAccounts = new Map<string, string[]>();

    // Process playertag accounts (all are pre-selected, no selection needed)
    accountsFromPlayertags.forEach((playertags, discordId) => {
      // Remove duplicates
      const uniqueTags = [...new Set(playertags)];
      if (uniqueTags.length === 1) {
        finalSingleAccountUsers.set(discordId, uniqueTags[0]);
      } else {
        // Multiple playertags for same user, but user specified them explicitly
        finalSingleAccountUsers.set(discordId, uniqueTags[0]); // Representative
        preSelectedAccounts.set(discordId, uniqueTags); // All of them
      }
    });

    // Process Discord ID accounts (only ask for selection if 2+ accounts)
    accountsFromDiscordIds.forEach((playertags, discordId) => {
      // Remove duplicates
      const uniqueTags = [...new Set(playertags)];

      // Check if this Discord ID was already handled by playertag input
      if (accountsFromPlayertags.has(discordId)) {
        const explicitlySelectedTags = accountsFromPlayertags.get(discordId)!;

        // If user specified playertags AND Discord ID, merge them
        // Combine explicit tags with all available tags for this user
        const allTagsForUser = [...new Set([...explicitlySelectedTags, ...uniqueTags])];

        if (allTagsForUser.length === 1) {
          // Still only one tag total, keep as single
          finalSingleAccountUsers.set(discordId, allTagsForUser[0]);
        } else if (allTagsForUser.length >= 2) {
          // Multiple tags - need selection
          // Remove from single account users if it was added there
          finalSingleAccountUsers.delete(discordId);
          finalMultipleAccountUsers.set(discordId, allTagsForUser);
          // Pre-select the explicitly specified playertags
          preSelectedAccounts.set(discordId, explicitlySelectedTags);
        }
        return;
      }

      if (uniqueTags.length === 1) {
        finalSingleAccountUsers.set(discordId, uniqueTags[0]);
      } else if (uniqueTags.length >= 2) {
        // Multiple accounts for this Discord user - need selection
        finalMultipleAccountUsers.set(discordId, uniqueTags);
      }
    });

    // Check if we found any linked accounts
    const totalLinkedAccounts = finalSingleAccountUsers.size + finalMultipleAccountUsers.size;
    if (totalLinkedAccounts === 0) {
      await interaction.editReply({
        content: `❌ No linked accounts found for the provided playertags/Discord IDs. Make sure the players are linked to Discord accounts in this server.`,
        embeds: [],
      });
      return;
    }

    // If no multiple account users, we can proceed directly
    if (finalMultipleAccountUsers.size === 0) {
      // Store data in cache for the final confirmation function
      memberChannelCache.set(interaction.id, {
        channelName,
        singleAccountUsers: finalSingleAccountUsers,
        multipleAccountUsers: finalMultipleAccountUsers,
        selectedAccounts: preSelectedAccounts, // Include pre-selected accounts from playertag input
        currentUserIndex: 0,
        multipleAccountUserIds: [],
        guildId,
        creatorId: interaction.user.id,
      });

      // Set up cleanup
      cleanupMemberChannelCache(interaction.id);

      // Use the shared final confirmation function
      await showFinalConfirmation(interaction);
      return;
    }

    // Store data in cache for pagination through multiple account users
    const multipleAccountUserIds = Array.from(finalMultipleAccountUsers.keys());
    memberChannelCache.set(interaction.id, {
      channelName,
      singleAccountUsers: finalSingleAccountUsers,
      multipleAccountUsers: finalMultipleAccountUsers,
      selectedAccounts: preSelectedAccounts, // Include any pre-selected accounts
      currentUserIndex: 0,
      multipleAccountUserIds,
      guildId,
      creatorId: interaction.user.id,
    });

    // Set up cleanup
    cleanupMemberChannelCache(interaction.id);

    // Start with the first user who has multiple accounts
    await showAccountSelectionForUser(interaction, 0);
  },
};

export async function showAccountSelectionForUser(
  interaction: ModalSubmitInteraction | StringSelectMenuInteraction,
  userIndex: number
) {
  const data = memberChannelCache.get(
    interaction instanceof ModalSubmitInteraction ? interaction.id : interaction.message.interactionMetadata?.id || ''
  );
  if (!data || !interaction || !interaction.guild) {
    if (interaction instanceof ModalSubmitInteraction) {
      await interaction.editReply({ content: '❌ Session expired. Please try again.', embeds: [], components: [] });
    } else {
      await interaction.update({ content: '❌ Session expired. Please try again.', embeds: [], components: [] });
    }
    return;
  }
  console.log(data);

  const discordId = data.multipleAccountUserIds[userIndex];
  const playertags = data.multipleAccountUsers.get(discordId)!;

  // Fetch player data for these playertags to show names
  const playerResults: (PlayerResult | FetchError)[] = await Promise.all(
    playertags.map((tag) => CR_API.getPlayer(tag))
  );

  const validPlayers = playerResults.filter((result): result is Player => !isFetchError(result));
  validPlayers.sort((a, b) => b.expLevel - a.expLevel);

  const playertagDescription = validPlayers
    .map((player) => `## [${player.name}](<https://royaleapi.com/player/${encodeURIComponent(player.tag)}>)`)
    .join('\n');
  const embed = new EmbedBuilder()
    .setTitle(`Account Selection - User ${userIndex + 1} of ${data.multipleAccountUserIds.length}`)
    .setDescription(
      `**<@${discordId}> has multiple accounts linked.\nUse the Select Menu below to choose which accounts you want to add.**:\n${playertagDescription}`
    )
    .setColor(EmbedColor.WARNING)
    .setFooter({
      text: `Step ${userIndex + 1}/${data.multipleAccountUserIds.length} • Select multiple accounts if needed`,
    });

  const select = new StringSelectMenuBuilder()
    .setCustomId(makeCustomId('s', 'member_channel_select', interaction.guild.id, { ownerId: data.creatorId }))
    .setPlaceholder('Select accounts for this user')
    .setMinValues(1)
    .setMaxValues(playertags.length);

  // Check if there are pre-selected accounts for this user
  const preSelectedTags = data.selectedAccounts.get(discordId) || [];

  // Add options for each account (pre-select if in preSelectedAccounts)
  validPlayers.forEach((player) => {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(player.name)
      .setDescription(`${player.tag} • Level ${player.expLevel}`)
      .setValue(player.tag);

    // Pre-select if this was explicitly chosen via playertag input
    if (preSelectedTags.includes(player.tag)) {
      option.setDefault(true);
    }

    select.addOptions(option);
  });

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  // Add a continue button to proceed with pre-selected values
  const continueButton = new ButtonBuilder()
    .setCustomId(
      makeCustomId('b', 'member_channel_continue', interaction.guild.id, {
        ownerId: data.creatorId,
        extra: [userIndex.toString()],
      })
    )
    .setLabel('Continue with Selected Accounts')
    .setStyle(ButtonStyle.Primary);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(continueButton);

  const updateData = {
    content: '',
    embeds: [embed],
    components: [selectRow, buttonRow],
  };

  if (interaction instanceof ModalSubmitInteraction) {
    await interaction.editReply(updateData);
  } else {
    await interaction.update(updateData);
  }
}

function parsePlayertags(input: string): string[] {
  const arr = Array.from(
    new Set(
      input
        .split(/[\s,]+/)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
    )
  );
  return arr;
}

function parseDiscordIds(input: string): string[] {
  const arr = Array.from(
    new Set(
      input
        .split(/\s+/)
        .map((id) => {
          // Remove mention formatting: <@123>, <@!123>
          const match = id.match(/^<@!?(\d+)>$/);
          return match ? match[1] : id.trim();
        })
        .filter((id) => id.length > 0)
    )
  );
  return arr;
}

async function fetchValidPlayers(playertags: string[]): Promise<Player[]> {
  const playerResults: (PlayerResult | FetchError)[] = await Promise.all(
    playertags.map((tag) => CR_API.getPlayer(tag))
  );
  return playerResults
    .filter((result): result is Player => !isFetchError(result))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getDiscordIdsFromPlayertags(
  guildId: string,
  playertags: string[]
): Promise<{ discord_id: string; playertag: string }[]> {
  if (playertags.length === 0) return [];
  const sql = buildGetLinkedDiscordIds(guildId, playertags);
  const res = await pool.query(sql);
  return res.rows; // [{ discord_id, playertag }]
}

async function getPlayertagsFromDiscordIds(guildId: string, discordIds: string[]) {
  if (discordIds.length === 0) return [];
  const sql = buildGetLinkedPlayertags(guildId, discordIds);
  const res = await pool.query(sql);
  return res.rows; // [{ discord_id, playertag }]
}

/** Group playertags by discord_id */
export function groupPlayertagsByDiscordId(rows: { discord_id: string; playertag: string }[]) {
  const map = new Map<string, string[]>();
  rows.forEach(({ discord_id, playertag }) => {
    if (!map.has(discord_id)) map.set(discord_id, []);
    map.get(discord_id)!.push(playertag);
  });
  // Remove duplicates
  map.forEach((tags, discordId) => map.set(discordId, [...new Set(tags)]));
  return map;
}

/** Separate users into single and multiple account users */
export function splitSingleAndMultipleAccountUsers(discordIdToPlayertags: Map<string, string[]>) {
  const singleAccountUsers = new Map<string, string>();
  const multipleAccountUsers = new Map<string, string[]>();
  discordIdToPlayertags.forEach((playertags, discordId) => {
    if (playertags.length === 1) singleAccountUsers.set(discordId, playertags[0]);
    else if (playertags.length > 1) multipleAccountUsers.set(discordId, playertags);
  });
  return { singleAccountUsers, multipleAccountUsers };
}

/**
 * Combines all playertags and Discord IDs from both input sources and fetches player names:
 * 1. Single account users (users with only one linked account)
 * 2. Selected accounts from multi-account users (collected via select menus)
 *
 * @param data The cached member channel data
 * @returns Map<discordId, PlayerInfo[]> - Final combined accounts with names for channel creation
 */
export async function getCombinedFinalAccountsWithNames(data: MemberChannelData): Promise<Map<string, PlayerInfo[]>> {
  const allFinalAccounts = new Map<string, PlayerInfo[]>();

  // Collect all playertags that need name lookup
  const allPlayertags = new Set<string>();

  // Add single account users playertags
  data.singleAccountUsers.forEach((playertag) => {
    allPlayertags.add(playertag);
  });

  // Add selected accounts playertags
  data.selectedAccounts.forEach((selectedPlayertags) => {
    selectedPlayertags.forEach((tag) => allPlayertags.add(tag));
  });

  // Fetch all player data at once for efficiency
  const playerResults: (PlayerResult | FetchError)[] = await Promise.all(
    Array.from(allPlayertags).map((tag) => CR_API.getPlayer(tag))
  );

  // Create a map of tag -> name for quick lookup and maintain order
  const tagToName = new Map<string, string>();
  const tagToPlayer = new Map<string, Player>();
  playerResults.forEach((result) => {
    if (!isFetchError(result)) {
      tagToName.set(result.tag, result.name);
      tagToPlayer.set(result.tag, result);
    }
  });

  // Add single account users (each has exactly one playertag)
  data.singleAccountUsers.forEach((playertag, discordId) => {
    const playerInfo = {
      tag: playertag,
      name: tagToName.get(playertag) || 'Unknown Player',
    };
    allFinalAccounts.set(discordId, [playerInfo]);
  });

  // Add selected accounts from multi-account users and sort by name
  data.selectedAccounts.forEach((selectedPlayertags, discordId) => {
    const playerInfos = selectedPlayertags
      .map((tag) => ({
        tag,
        name: tagToName.get(tag) || 'Unknown Player',
        player: tagToPlayer.get(tag),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)) // Sort by name
      .map(({ tag, name }) => ({ tag, name }));
    allFinalAccounts.set(discordId, playerInfos);
  });

  return allFinalAccounts;
}

// TODO: Create handler for member_channel_select select menu interaction
// TODO: Move to next user or finish channel creation

export default createMemberChannelIndentifier;
