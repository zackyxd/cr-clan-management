import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ContainerBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { checkFeature } from '../../utils/checkFeatureEnabled.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { normalizeTag } from '../../api/CR_API.js';
import { pool } from '../../db.js';
import { getRaceAttacks, initializeOrUpdateRace } from '../../features/race-tracking/service.js';
import { getNudgeMessage } from '../../features/race-tracking/nudgeHelper.js';
import {
  enrichParticipantsWithLinks,
  formatParticipantsList,
  buildFooterLegend,
} from '../../features/race-tracking/attacksFormatter.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('nudge')
    .setDescription('Send a nudge to all members with attacks remaining in a clan')
    .addStringOption((option) => option.setName('clantag').setDescription('#ABC123').setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    // const userId = interaction.user.id;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;

    const userInput = interaction.options.getString('clantag') as string;
    const normalizedTag = normalizeTag(userInput);

    const clanRes = await pool.query(
      `SELECT clantag, clan_name, race_custom_nudge_message, race_nudge_channel_id 
       FROM clans WHERE guild_id = $1 AND (clantag = $2 OR LOWER(abbreviation) = LOWER($3))`,
      [guild.id, normalizedTag, userInput], // userInput catches if abbreviation is used
    );

    const fixedClantag = clanRes.rows.length > 0 ? clanRes.rows[0].clantag : normalizedTag;
    const customMessage = clanRes.rows[0]?.race_custom_nudge_message;
    const nudgeChannelId = clanRes.rows[0]?.race_nudge_channel_id;

    const result = await initializeOrUpdateRace(guild.id, fixedClantag);
    if (!result) {
      await interaction.editReply('❌ Failed to fetch race data. Please try again later.');
      return;
    }

    const nudgeMessage =
      (await getNudgeMessage(guild.id, fixedClantag, clanRes.rows[0]?.clan_name, result.warDay, customMessage)) +
      ` (Sent by ${interaction.user.tag})`;

    const attacksData = await getRaceAttacks(guild.id, result.raceData, result.seasonId, result.warWeek);
    if (!attacksData) {
      await interaction.editReply('❌ Failed to fetch attacks data. Please try again later.');
      return;
    }

    // Enrich participants with Discord linking and channel access
    const enrichedParticipants = await enrichParticipantsWithLinks(guild.id, attacksData.participants, {
      mentionUsers: true,
      channelId: nudgeChannelId,
      guild: guild,
    });

    // Format participant lines with mentions
    const lines = formatParticipantsList(enrichedParticipants, {
      mentionUsers: true,
      channelId: nudgeChannelId,
      guild: guild,
    });

    if (lines.length === 0) {
      await interaction.editReply('✅ Everyone has completed their attacks!');
      return;
    }

    // Build footer legend
    const footerText = buildFooterLegend(enrichedParticipants, {
      mentionUsers: true,
      channelId: nudgeChannelId,
      guild: guild,
    });

    // Send nudge to channel
    if (!nudgeChannelId) {
      await interaction.editReply('❌ No nudge channel configured for this clan. Set one in `/clan-settings`.');
      return;
    }

    try {
      const nudgeChannel = await guild.channels.fetch(nudgeChannelId);
      if (!nudgeChannel?.isTextBased()) {
        await interaction.editReply('❌ Nudge channel not found or is not a text channel.');
        return;
      }

      // Build Components v2 message with builders
      const nudgeText = new TextDisplayBuilder().setContent(nudgeMessage);
      const separator1 = new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
      const participantsList = new TextDisplayBuilder().setContent(lines.join('\n'));

      const container = new ContainerBuilder()
        .setAccentColor(BOTCOLOR)
        .addTextDisplayComponents(nudgeText)
        .addSeparatorComponents(separator1)
        .addTextDisplayComponents(participantsList);

      // Add footer if present
      if (footerText) {
        const separator2 = new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
        const footer = new TextDisplayBuilder().setContent(footerText);
        container.addSeparatorComponents(separator2).addTextDisplayComponents(footer);
      }

      await nudgeChannel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [container],
      });

      await interaction.editReply(`✅ Nudge sent to <#${nudgeChannelId}>!`);
    } catch (error) {
      console.error('Error sending nudge:', error);
      await interaction.editReply('❌ Failed to send nudge. Check bot permissions and channel configuration.');
    }
  },
};

export default command;
