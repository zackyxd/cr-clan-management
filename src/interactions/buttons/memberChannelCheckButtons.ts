import { ButtonInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { ButtonHandler } from '../handleButtonInteraction.js';
import { getChannelMembers, findMissingMembers, getMemberChannelInfo } from '../../utils/memberChannelHelpers.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { CR_API, FetchError } from '../../api/CR_API.js';

const checkMemberButton: ButtonHandler = {
  customId: 'check_members',
  async execute(interaction: ButtonInteraction, parsed: ParsedCustomId) {
    const { guildId, extra } = parsed;
    const action = extra[0]; // 'checkMembers', 'pingMembers', etc.
    const channelId = extra[1];

    // Check permissions
    if (!interaction?.guild) return;
    const allowed = await checkPerms(interaction, interaction.guild.id, 'button', 'either', { hideNoPerms: true });
    if (!allowed) return;

    // Get fresh member channel info
    const channelInfo = await getMemberChannelInfo(guildId, channelId);
    if (!channelInfo) {
      await interaction.editReply({
        content: '❌ This channel is not registered as a member channel.',
      });
      return;
    }

    if (action === 'checkMembers') {
      // Check if channel has a clan focus
      if (!channelInfo.clantag_focus) {
        await interaction.editReply({
          content: '❌ No clan focus set for this channel. Cannot compare with clan members.',
        });
        return;
      }

      // Get fresh clan data
      const clanData = await CR_API.getClan(channelInfo.clantag_focus);
      if ('error' in clanData) {
        const fetchError = clanData as FetchError;
        const embed =
          fetchError.embed ??
          new EmbedBuilder()
            .setDescription(`Failed to fetch clan data for ${channelInfo.clantag_focus}`)
            .setColor(EmbedColor.FAIL);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Get channel members from database
      const channelMembers = await getChannelMembers(guildId, channelId);
      console.log(channelMembers);

      // Compare with clan members
      const comparison = findMissingMembers(channelMembers, clanData.memberList);

      // Create player list with status indicators
      const playerList: string[] = [];

      // Add joined players first (with checkmark)
      comparison.inClan.forEach((member) => {
        playerList.push(`${member.name} ✅`);
      });

      // Add missing players (with X mark and Discord mention)
      comparison.missingFromClan.forEach((member) => {
        playerList.push(`[${member.name}](<https://royaleapi.com/player/${member.tag.substring(1)}>) ❌`);
      });

      const embed = new EmbedBuilder()
        .setTitle(`Member Check - ${clanData.name}`)
        .setDescription(
          `**Players Joined:** ${comparison.inClan.length}/${comparison.totalChannelPlayers}\n\n` +
            playerList.join('\n')
        )
        .setColor(comparison.missingFromClan.length > 0 ? EmbedColor.WARNING : EmbedColor.SUCCESS)
        .setFooter({ text: `Member Count: ${comparison.totalClanMembers}/50` });

      await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } else if (action === 'pingMembers') {
      // Implementation for pinging missing members
      await interaction.editReply({ content: '🚧 Ping missing members feature coming soon!' });
    } else if (action === 'addMember') {
      // Implementation for adding a member
      await interaction.editReply({ content: '🚧 Add member feature coming soon!' });
    } else if (action === 'removeMember') {
      // Implementation for removing a member
      await interaction.editReply({ content: '🚧 Remove member feature coming soon!' });
    } else {
      await interaction.editReply({ content: '❌ Unknown action.' });
    }
  },
};

export default checkMemberButton;
