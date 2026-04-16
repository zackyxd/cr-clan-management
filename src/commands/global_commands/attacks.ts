import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, EmbedBuilder } from 'discord.js';
import { getCurrentRiverRace, isFetchError, normalizeTag } from '../../api/CR_API.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';
import { getRaceAttacks, initializeOrUpdateRace, periodTypeMap } from '../../features/race-tracking/index.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';

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

    // Build embed description
    const lines: string[] = [];

    // Filter out completed non-violators and count groups
    const filteredParticipants = attacksData.participants.filter(
      (p) => p.attacksRemaining > 0 || p.isSplitAttacker || p.hasAttackedElsewhere,
    );

    // Count participants per attack group
    const groupCounts = new Map<number, number>();
    for (const participant of filteredParticipants) {
      groupCounts.set(participant.attacksRemaining, (groupCounts.get(participant.attacksRemaining) || 0) + 1);
    }

    // Group by attacks remaining
    let currentAttacksGroup = -1;

    for (const participant of filteredParticipants) {
      if (participant.playertag === '#RUQPYRVP') {
        console.log(participant);
      }
      // Add section header when entering new attack count group
      if (participant.attacksRemaining !== currentAttacksGroup) {
        currentAttacksGroup = participant.attacksRemaining;
        const count = groupCounts.get(currentAttacksGroup) || 0;
        if (lines.length > 0) lines.push(''); // Blank line between groups
        lines.push(`__**${currentAttacksGroup} Attack${currentAttacksGroup !== 1 ? 's' : ''} (${count})**__`);
      }

      // Build player line
      let line = '* ';

      // Player name (no pinging in /attacks, only in nudges)
      line += participant.playerName;

      // Add emojis for special statuses
      if (participant.isSplitAttacker) {
        line += ' ☠️';
      }
      if (participant.hasAttackedElsewhere) {
        line += ' 🚫';
      }
      if (participant.isReplacementPlayer) {
        line += ' ⚠️';
      }
      if (participant.isAttackingLate) {
        line += ' ⏰';
      }
      if (!participant.isInClan) {
        line += ' ❌';
      }

      // Show attacks used today in this clan
      if (
        participant.attacksUsedToday > 0 &&
        (participant.isSplitAttacker || participant.isReplacementPlayer || participant.isAttackingLate)
      ) {
        line += ` (Used ${participant.attacksUsedToday} in clan)`;
      }

      // Show which clans they attacked in if they have attacks elsewhere
      if (participant.clansAttackedIn.length > 1 || participant.hasAttackedElsewhere) {
        line += ` — *Attacked in: ${participant.clansAttackedIn.join(' & ')}*`;
      }

      lines.push(line);
    }

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

    // Build footer text based on what's actually present
    const footerParts: string[] = [];
    const hasSplitAttackers = filteredParticipants.some((p) => p.isSplitAttacker);
    const hasAttackedElsewhere = filteredParticipants.some((p) => p.hasAttackedElsewhere);
    const hasReplacementPlayers = filteredParticipants.some((p) => p.isReplacementPlayer);
    const hasAttackingLate = filteredParticipants.some((p) => p.isAttackingLate);
    const hasLeftClan = filteredParticipants.some((p) => !p.isInClan);

    if (hasSplitAttackers) footerParts.push('☠️ = Split attacker\n');
    if (hasAttackedElsewhere) footerParts.push('🚫 = Do not attack (started elsewhere)\n');
    if (hasReplacementPlayers) footerParts.push('⚠️ = Replace me\n');
    if (hasAttackingLate) footerParts.push('⏰ = Attacking late\n');
    if (hasLeftClan) footerParts.push('❌ = Left clan\n');

    const description = `:playersLeft: ${attacksData.availableAttackers}\n:decksLeft: ${attacksData.totalAttacksRemaining}\n\n`;

    const embed = new EmbedBuilder()
      .setTitle(`${attacksData.clanInfo.name}`)
      .setAuthor({
        name: `Season ${attacksData.seasonId ?? '---'} | Week ${attacksData.warWeek} | Day ${attacksData.raceDay}`,
      })
      .setColor(BOTCOLOR)
      .setDescription(`## ${periodTypeMap[raceData.periodType] || ''} Attacks\n${lines.join('\n')}\n\n${description}`)
      .setURL(`https://cwstats.com/clan/${attacksData.clanInfo.clantag.substring(1)}/race`);

    if (footerParts.length > 0) {
      embed.setFooter({ text: footerParts.join('') });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
