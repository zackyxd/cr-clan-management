import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, EmbedBuilder } from 'discord.js';
import { getCurrentRiverRace, isFetchError, normalizeTag } from '../../api/CR_API.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';
import { getRaceAttacks, initializeOrUpdateRace, periodTypeMap } from '../../features/race-tracking/index.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';
import {
  enrichParticipantsWithLinks,
  formatParticipantsList,
  buildFooterLegend,
} from '../../features/race-tracking/attacksFormatter.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('attacks')
    .setDescription('Check the attacks remaining in this clan')
    .addStringOption((option) => option.setName('clantag').setDescription('#ABC123').setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    const userInput = interaction.options.getString('clantag') as string;
    const normalizedTag = normalizeTag(userInput);

    const clanRes = await pool.query(
      `SELECT clantag FROM clans WHERE guild_id = $1 AND (clantag = $2 OR LOWER(abbreviation) = LOWER($3))`,
      [guild.id, normalizedTag, userInput],
    );

    const fixedClantag = clanRes.rows.length > 0 ? clanRes.rows[0].clantag : normalizedTag;

    const result = await initializeOrUpdateRace(guild.id, fixedClantag);
    if (!result) {
      await interaction.editReply('❌ Failed to fetch race data. Please try again later.');
      return;
    }

    const { raceData, seasonId, warWeek } = result;
    const attacksData = await getRaceAttacks(guild.id, raceData, seasonId, warWeek);
    if (!attacksData) {
      await interaction.editReply('❌ Failed to fetch attacks data. Please try again later.');
      return;
    }

    // Enrich participants (no linking for /attacks - display only)
    const enrichedParticipants = await enrichParticipantsWithLinks(guild.id, attacksData.participants, {
      mentionUsers: false, // Don't ping in /attacks
    });

    // Format participant lines
    const lines = formatParticipantsList(enrichedParticipants, {
      mentionUsers: false,
    });

    if (lines.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle(`${attacksData.clanInfo.name}`)
        .setAuthor({
          name: `Season ${attacksData.seasonId ?? '---'} | Week ${attacksData.warWeek} | Day ${attacksData.raceDay}`,
        })
        .setColor(BOTCOLOR)
        .setDescription(
          `## ${periodTypeMap[raceData.periodType] || ''} Attacks\n✅ Everyone has completed their attacks!`,
        )
        .setURL(`https://cwstats.com/clan/${attacksData.clanInfo.clantag.substring(1)}/race`);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Build footer legend
    const footerText = buildFooterLegend(enrichedParticipants, { mentionUsers: false });

    const description = `:playersLeft: ${attacksData.availableAttackers}\n:decksLeft: ${attacksData.totalAttacksRemaining}\n\n`;

    const embed = new EmbedBuilder()
      .setTitle(`${attacksData.clanInfo.name}`)
      .setAuthor({
        name: `Season ${attacksData.seasonId ?? '---'} | Week ${attacksData.warWeek} | Day ${attacksData.raceDay}`,
      })
      .setColor(BOTCOLOR)
      .setDescription(`## ${periodTypeMap[raceData.periodType] || ''} Attacks\n${lines.join('\n')}\n\n${description}`)
      .setURL(`https://cwstats.com/clan/${attacksData.clanInfo.clantag.substring(1)}/race`);

    if (footerText) {
      embed.setFooter({ text: footerText });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
