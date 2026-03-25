import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { makeCustomId } from './customId.js';
import { CR_API } from '../api/CR_API.js';
import { MemberData } from './memberChannelHelpers.js';

interface MemberChannelData {
  channel_id: string;
  clantag_focus: string | null;
  clan_name_focus: string | null;
  members: MemberData[];
  last_ping: Date | null;
  current_delete_count: number;
  delete_confirmed_by: string[] | null;
  delete_confirm_count: number;
  is_locked: boolean;
}

export async function buildMemberChannelCheckUI(
  channelData: MemberChannelData,
  guildId: string,
): Promise<{
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
}> {
  // Calculate total accounts from members
  const totalMembers = channelData.members.length;
  const totalAccounts = channelData.members.reduce((sum: number, member: MemberData) => {
    if (Array.isArray(member.players)) {
      return sum + member.players.length;
    } else if (member.players && typeof member.players === 'object' && 'count' in member.players) {
      return sum + member.players.count;
    }
    return sum;
  }, 0);

  const confirmedBy: string[] = channelData.delete_confirmed_by || [];
  const pendingDeleteWarning =
    confirmedBy.length > 0
      ? `\n\n⚠️ **Delete confirmations: ${confirmedBy.length}/${channelData.delete_confirm_count}**\n-# Confirmed by: ${confirmedBy.map((id: string) => `<@${id}>`).join(', ')}`
      : '';

  let embed: EmbedBuilder;

  // Build embed based on whether there's a clan focus
  if (channelData.clantag_focus) {
    const clanData = await CR_API.getClan(channelData.clantag_focus);

    if ('error' in clanData) {
      // If clan fetch fails, show basic info
      embed = new EmbedBuilder()
        .setTitle(`${channelData.clan_name_focus || 'Member Channel'} Info`)
        .setDescription(
          `**Clan:** ${channelData.clan_name_focus} (${channelData.clantag_focus})\n` +
            `**Channel Members:** ${totalMembers}\n` +
            `**Accounts Selected:** ${totalAccounts}\n` +
            `**Last Ping:** ${channelData.last_ping ? new Date(channelData.last_ping).toLocaleString() : 'N/A'}` +
            pendingDeleteWarning +
            (channelData.is_locked ? '\n\n🔒 Locked.' : ''),
        )
        .setColor(confirmedBy.length > 0 ? 'Orange' : 'Blue');
    } else {
      embed = new EmbedBuilder()
        .setTitle(`${channelData.clan_name_focus || 'Member Channel'} Info`)
        .setDescription(
          `**Clan:** ${channelData.clan_name_focus} (${channelData.clantag_focus})\n` +
            `**Clan Members:** ${clanData.members}/50\n` +
            `**Channel Members:** ${totalMembers}\n` +
            `**Accounts Selected:** ${totalAccounts}\n` +
            `**Last Ping:** ${channelData.last_ping ? new Date(channelData.last_ping).toLocaleString() : 'N/A'}` +
            pendingDeleteWarning +
            (channelData.is_locked ? '\n\n🔒 Locked.' : ''),
        )
        .setColor(confirmedBy.length > 0 ? 'Orange' : 'Blue');
    }
  } else {
    // No clan focus - show basic channel info
    embed = new EmbedBuilder()
      .setTitle('Member Channel Info')
      .setDescription(
        `**Clan Focus:** None\n` +
          `**Channel Members:** ${totalMembers}\n` +
          `**Accounts Selected:** ${totalAccounts}\n` +
          `**Last Ping:** ${channelData.last_ping ? new Date(channelData.last_ping).toLocaleString() : 'N/A'}` +
          pendingDeleteWarning +
          (channelData.is_locked ? '\n\n🔒 Locked.' : ''),
      )
      .setColor(confirmedBy.length > 0 ? 'Orange' : 'Blue');
  }

  // Build buttons
  const checkMemberButton = new ButtonBuilder()
    .setLabel('Check Members')
    .setCustomId(makeCustomId('b', 'memberChannel_checkMembers', guildId, { cooldown: 2 }))
    .setStyle(ButtonStyle.Primary);

  const pingMemberButton = new ButtonBuilder()
    .setLabel('Ping Missing Members')
    .setCustomId(makeCustomId('b', 'memberChannel_pingMembers', guildId, { cooldown: 2 }))
    .setStyle(ButtonStyle.Primary);

  const addMemberToChannel = new ButtonBuilder()
    .setLabel('Add Members')
    .setCustomId(makeCustomId('b', 'memberChannel_addMembers', guildId, { cooldown: 2 }))
    .setStyle(ButtonStyle.Primary);

  const removeMemberToChannel = new ButtonBuilder()
    .setLabel('Remove Member')
    .setCustomId(makeCustomId('b', 'memberChannel_removeMember', guildId, { cooldown: 2 }))
    .setStyle(ButtonStyle.Primary);

  const deleteChannelButton = new ButtonBuilder()
    .setLabel('Delete Channel')
    .setCustomId(makeCustomId('b', 'memberChannel_deleteChannel', guildId, { cooldown: 2 }))
    .setStyle(ButtonStyle.Danger);

  const lockChannelButton = new ButtonBuilder()
    .setLabel(channelData.is_locked === true ? 'Unlock Channel' : 'Lock Channel')
    .setCustomId(makeCustomId('b', 'memberChannel_lockChannel', guildId, { cooldown: 2 }))
    .setStyle(ButtonStyle.Secondary);

  const renameChannelButton = new ButtonBuilder()
    .setLabel('Rename Channel')
    .setCustomId(makeCustomId('b', 'memberChannel_renameChannel', guildId, { cooldown: 2 }))
    .setStyle(ButtonStyle.Secondary);

  const changeFocusButton = new ButtonBuilder()
    .setLabel('Change Clan Focus')
    .setCustomId(makeCustomId('b', 'memberChannel_changeFocus', guildId, { cooldown: 2 }))
    .setStyle(ButtonStyle.Secondary);

  const memberActionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    checkMemberButton,
    pingMemberButton,
    addMemberToChannel,
    removeMemberToChannel,
  );

  const channelActionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    lockChannelButton,
    renameChannelButton,
    changeFocusButton,
    deleteChannelButton,
  );

  return {
    embed,
    components: [memberActionRow, channelActionRow],
  };
}
