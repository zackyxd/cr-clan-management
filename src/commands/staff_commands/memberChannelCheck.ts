import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { checkFeature } from '../../utils/checkFeatureEnabled.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';
import { makeCustomId } from '../../utils/customId.js';
import { CR_API, FetchError } from '../../api/CR_API.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { MemberData } from '../../utils/memberChannelHelpers.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('check')
    .setDescription('(Coleader+) Use this inside of a member channel to manage it.'),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Implementation for member channel check command
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const featureCheck = await checkFeature(interaction, guild.id, 'member_channels');
    if (!featureCheck) {
      return;
    }

    const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });

    if (!allowed) return;

    const validChannelSQL = await pool.query(
      `
      SELECT mc.channel_id, mc.clantag_focus, mc.clan_name_focus, mc.members, mc.last_ping, mc.current_delete_count, mc.delete_confirmed_by,
             COALESCE(mcs.delete_confirm_count, 2) as delete_confirm_count
      FROM member_channels mc
      LEFT JOIN member_channel_settings mcs ON mc.guild_id = mcs.guild_id
      WHERE mc.guild_id = $1 AND mc.channel_id = $2
      `,
      [guild.id, interaction.channelId],
    );
    const res = validChannelSQL.rows[0];
    console.log(res);
    if (!res) {
      await interaction.editReply({
        content: '❌ This command can only be used inside of a member channel.',
      });
      return;
    }

    const checkMemberButton = new ButtonBuilder()
      .setLabel('Check Members')
      .setCustomId(
        makeCustomId('b', 'memberChannel_checkMembers', guild.id, {
          cooldown: 2,
        }),
      )
      .setStyle(ButtonStyle.Primary);

    const pingMemberButton = new ButtonBuilder()
      .setLabel('Ping Missing Members')
      .setCustomId(
        makeCustomId('b', 'memberChannel_pingMembers', guild.id, {
          cooldown: 2,
        }),
      )
      .setStyle(ButtonStyle.Primary);

    const addMemberToChannel = new ButtonBuilder()
      .setLabel('Add Members')
      .setCustomId(makeCustomId('b', 'memberChannel_addMembers', guild.id, { cooldown: 2 }))
      .setStyle(ButtonStyle.Primary);

    const removeMemberToChannel = new ButtonBuilder()
      .setLabel('Remove Member')
      .setCustomId(
        makeCustomId('b', 'memberChannel_removeMember', guild.id, {
          cooldown: 2,
        }),
      )
      .setStyle(ButtonStyle.Primary);

    const deleteChannelButton = new ButtonBuilder()
      .setLabel('Delete Channel')
      .setCustomId(
        makeCustomId('b', 'memberChannel_deleteChannel', guild.id, {
          cooldown: 2,
        }),
      )
      .setStyle(ButtonStyle.Danger);

    const renameChannelButton = new ButtonBuilder()
      .setLabel('Rename Channel')
      .setCustomId(
        makeCustomId('b', 'memberChannel_renameChannel', guild.id, {
          cooldown: 2,
        }),
      )
      .setStyle(ButtonStyle.Primary);

    const changeFocusButton = new ButtonBuilder()
      .setLabel('Change Clan Focus')
      .setCustomId(
        makeCustomId('b', 'memberChannel_changeFocus', guild.id, {
          cooldown: 2,
        }),
      )
      .setStyle(ButtonStyle.Primary);

    let clanInfo: EmbedBuilder;

    // Calculate total accounts from members
    const totalMembers = res.members.length;
    const totalAccounts = res.members.reduce((sum: number, member: MemberData) => {
      if (Array.isArray(member.players)) {
        return sum + member.players.length;
      } else if (member.players && typeof member.players === 'object' && 'count' in member.players) {
        return sum + member.players.count;
      }
      return sum;
    }, 0);

    // Check if channel has a clan focus
    if (res.clantag_focus) {
      const clanData = await CR_API.getClan(res.clantag_focus);

      if ('error' in clanData) {
        const fetchError = clanData as FetchError;

        const embed =
          fetchError.embed ??
          new EmbedBuilder().setDescription(`Failed to fetch ${res.clantag_focus}`).setColor(EmbedColor.FAIL);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const confirmedBy: string[] = res.delete_confirmed_by || [];
      const pendingDeleteWarning =
        confirmedBy.length > 0
          ? `\n\n⚠️ **Delete confirmations: ${confirmedBy.length}/${res.delete_confirm_count}**\n-# Confirmed by: ${confirmedBy.map((id: string) => `<@${id}>`).join(', ')}`
          : '';

      clanInfo = new EmbedBuilder()
        .setTitle(`${res.clan_name_focus || 'Member Channel'} Info`)
        .setDescription(
          `**Clan:** ${res.clan_name_focus} (${res.clantag_focus})\n` +
            `**Clan Members:** ${clanData.members}/50\n` +
            `**Channel Members:** ${totalMembers}\n` +
            `**Accounts Selected:** ${totalAccounts}\n` +
            `**Last Ping:** ${res.last_ping ? new Date(res.last_ping).toLocaleString() : 'N/A'}` +
            pendingDeleteWarning,
        )
        .setColor(confirmedBy.length > 0 ? 'Orange' : 'Blue');
    } else {
      // No clan focus - show basic channel info
      const confirmedBy: string[] = res.delete_confirmed_by || [];
      const pendingDeleteWarning =
        confirmedBy.length > 0
          ? `\n\n⚠️ **Delete confirmations: ${confirmedBy.length}/${res.delete_confirm_count}**\n-# Confirmed by: ${confirmedBy.map((id: string) => `<@${id}>`).join(', ')}`
          : '';

      clanInfo = new EmbedBuilder()
        .setTitle('Member Channel Info')
        .setDescription(
          `**Clan Focus:** None\n` +
            `**Channel Members:** ${totalMembers}\n` +
            `**Accounts Selected:** ${totalAccounts}\n` +
            `**Last Ping:** ${res.last_ping ? new Date(res.last_ping).toLocaleString() : 'N/A'}` +
            pendingDeleteWarning,
        )
        .setColor(confirmedBy.length > 0 ? 'Orange' : 'Blue');
    }

    const memberActionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      checkMemberButton,
      pingMemberButton,
      addMemberToChannel,
      removeMemberToChannel,
    );
    const channelActionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      renameChannelButton,
      changeFocusButton,
      deleteChannelButton,
    );

    await interaction.editReply({
      embeds: [clanInfo],
      components: [memberActionRow, channelActionRow],
    });
  },
};

export default command;
