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
      SELECT channel_id, clantag_focus, clan_name_focus, members, last_ping
      FROM member_channels
      WHERE guild_id = $1 AND channel_id = $2
      `,
      [guild.id, interaction.channelId]
    );
    const res = validChannelSQL.rows[0];

    if (!res) {
      await interaction.editReply({
        content: '❌ This command can only be used inside of a member channel.',
      });
      return;
    }

    const checkMemberButton = new ButtonBuilder()
      .setLabel('Check Members')
      .setCustomId(
        makeCustomId('b', 'check_members', guild.id, { cooldown: 2, extra: ['checkMembers', res.channel_id] })
      )
      .setStyle(ButtonStyle.Primary);

    const pingMemberButton = new ButtonBuilder()
      .setLabel('Ping Missing Members')
      .setCustomId(
        makeCustomId('b', 'check_members', guild.id, { cooldown: 2, extra: ['pingMembers', res.channel_id] })
      )
      .setStyle(ButtonStyle.Primary);

    const addMemberToChannel = new ButtonBuilder()
      .setLabel('Add Member')
      .setCustomId(makeCustomId('b', 'check_members', guild.id, { cooldown: 2, extra: ['addMember', res.channel_id] }))
      .setStyle(ButtonStyle.Primary);

    const removeMemberToChannel = new ButtonBuilder()
      .setLabel('Remove Member')
      .setCustomId(
        makeCustomId('b', 'check_members', guild.id, { cooldown: 2, extra: ['removeMember', res.channel_id] })
      )
      .setStyle(ButtonStyle.Primary);

    const deleteChannelButton = new ButtonBuilder()
      .setLabel('Delete Channel')
      .setCustomId(
        makeCustomId('b', 'check_members', guild.id, { cooldown: 2, extra: ['deleteChannel', res.channel_id] })
      )
      .setStyle(ButtonStyle.Danger);

    const renameChannelButton = new ButtonBuilder()
      .setLabel('Rename Channel')
      .setCustomId(
        makeCustomId('b', 'check_members', guild.id, { cooldown: 2, extra: ['renameMember', res.channel_id] })
      )
      .setStyle(ButtonStyle.Primary);

    const changeFocusButton = new ButtonBuilder()
      .setLabel('Change Clan Focus')
      .setCustomId(
        makeCustomId('b', 'check_members', guild.id, { cooldown: 2, extra: ['changeFocus', res.channel_id] })
      )
      .setStyle(ButtonStyle.Primary);

    const clanData = await CR_API.getClan(res.clantag_focus);

    if ('error' in clanData) {
      const fetchError = clanData as FetchError;

      const embed =
        fetchError.embed ??
        new EmbedBuilder().setDescription(`Failed to fetch ${res.clantag_focus}`).setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const clanInfo = new EmbedBuilder()
      .setTitle(`${res.clan_focus ? res.clan_focus : 'Member Channel'} Info`)
      .setDescription(
        `Current Members: ${clanData.members}/50\nLast Ping: ${
          res.last_ping ? new Date(res.last_ping).toLocaleString() : 'N/A'
        }`
      );

    const memberActionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      checkMemberButton,
      pingMemberButton,
      addMemberToChannel,
      removeMemberToChannel
    );
    const channelActionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      renameChannelButton,
      changeFocusButton,
      deleteChannelButton
    );

    await interaction.editReply({
      embeds: [clanInfo],
      components: [memberActionRow, channelActionRow],
    });
  },
};

export default command;
