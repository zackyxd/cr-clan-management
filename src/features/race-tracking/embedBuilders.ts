/**
 * Reusable embed builders for race tracking messages.
 * Used by both commands and automatic posting.
 */
import { EmbedBuilder } from 'discord.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';
import { periodTypeMap, getDayForDisplay } from './service.js';
import { RaceAttacksData, RaceStatsData } from './types.js';
import { enrichParticipantsWithLinks, formatParticipantsList, buildFooterLegend } from './attacksFormatter.js';
import { getNextDayRelativeTimestamp } from './timeUtils.js';
import { CurrentRiverRace } from '../../api/CR_API.js';
import { getEmoji } from '../../utils/emoji.js';

/**
 * Build an attacks embed for display.
 * Handles both empty (all done) and populated participant lists.
 *
 * @param guildId - Discord guild ID
 * @param attacksData - Processed attack data
 * @param raceData - Raw race data from API
 * @param endTime - Race end time (if available)
 * @param mentionUsers - Whether to mention users (false for display, true for nudges)
 * @returns Discord embed ready to send
 */
export async function buildAttacksEmbed(
  guildId: string,
  attacksData: RaceAttacksData,
  raceData: CurrentRiverRace,
  endTime: Date | null,
  mentionUsers = false,
): Promise<EmbedBuilder> {
  // Enrich participants with Discord links
  const enrichedParticipants = await enrichParticipantsWithLinks(guildId, attacksData.participants, {
    mentionUsers,
  });

  let description: string;

  // Handle boat completion differently - show who attacked instead of who's remaining
  if (attacksData.isBoatCompleted) {
    description = `🏁\n`;
    description += `**${attacksData.participants.length} players attacked in clan.**\n\n`;

    // Group by attacks used today
    const attackGroups = new Map<number, typeof enrichedParticipants>();
    for (const participant of enrichedParticipants) {
      const attacks = participant.attacksUsedToday;
      if (!attackGroups.has(attacks)) {
        attackGroups.set(attacks, []);
      }
      attackGroups.get(attacks)!.push(participant);
    }

    // Sort groups descending (4 attacks, then 3, then 2, then 1)
    const sortedGroups = Array.from(attackGroups.entries()).sort((a, b) => b[0] - a[0]);

    const groupLines: string[] = [];
    for (const [attacks, players] of sortedGroups) {
      groupLines.push(`__**${attacks} Attack${attacks !== 1 ? 's' : ''} (${players.length})**__`);
      for (const player of players) {
        const mention = mentionUsers && player.discordUserId ? `<@${player.discordUserId}>` : `* ${player.playerName}`;
        groupLines.push(mention);
      }
      groupLines.push(''); // Blank line between groups
    }

    description += groupLines.join('\n');

    // Calculate total attacks used by participants who attacked today
    const totalAttacksUsed = enrichedParticipants.reduce((sum, p) => sum + p.attacksUsedToday, 0);
    const playersWhoAttacked = enrichedParticipants.length;

    // Add summary line showing who attacked (instead of who's remaining)
    description += `\n:playersLeft: ${playersWhoAttacked}\n:attacksLeft: ${totalAttacksUsed}`;
  } else {
    // Normal attacks remaining display
    const lines = formatParticipantsList(
      enrichedParticipants,
      attacksData.totalAttacksRemaining,
      attacksData.availableAttackers,
      {
        mentionUsers,
      },
    );

    if (lines.length === 0) {
      description = `## ${periodTypeMap[raceData.periodType] || ''} Attacks\n✅ Everyone has completed their attacks!`;
      if (endTime) {
        description += `\n\n-# War ends ~${getNextDayRelativeTimestamp(endTime)}`;
      }
    } else {
      description = `## ${periodTypeMap[raceData.periodType] || ''} Attacks\n${lines.join('\n')}`;
      if (endTime) {
        description += `\n\n-# War ends ~${getNextDayRelativeTimestamp(endTime)}`;
      }
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`${attacksData.clanInfo.name}`)
    .setAuthor({
      name: `Season ${attacksData.seasonId ?? '---'} | Week ${attacksData.warWeek} | Day ${getDayForDisplay(attacksData.raceDay)}`,
    })
    .setColor(BOTCOLOR)
    .setDescription(description)
    .setURL(`https://cwstats.com/clan/${attacksData.clanInfo.clantag.substring(1)}/race`);

  if (!attacksData.isBoatCompleted && description.includes('__**')) {
    const footerText = buildFooterLegend(enrichedParticipants, { mentionUsers });
    if (footerText) {
      embed.setFooter({ text: footerText });
    }
  }

  return embed;
}

/**
 * Build a race standings embed for display.
 *
 * @param stats - Race statistics data
 * @param clantag - Clan tag for URL and highlighting
 * @param seasonId - Season ID
 * @param warWeek - War week number
 * @param warDay - War day number
 * @param endTime - Race end time (if available)
 * @returns Discord embed ready to send
 */
export function buildRaceEmbed(
  stats: RaceStatsData,
  clantag: string,
  seasonId: number | null,
  warWeek: number,
  warDay: number,
  endTime: Date | null,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(BOTCOLOR)
    .setURL(`https://cwstats.com/clan/${clantag.substring(1)}/race`)
    .setAuthor({
      name: `Season ${seasonId ?? '---'} | Week ${warWeek} | Day ${getDayForDisplay(warDay)}`,
    });

  let description = '';
  // console.log(stats);
  if (stats.type === 'training') {
    embed.setTitle('Training Day');
    stats.clans.forEach((clan, index) => {
      const escapedName = escapeMarkdown(clan.name);
      const clantagForUrl = clan.clantag.substring(1); // Remove #

      if (clan.clantag === clantag) {
        description += `${index + 1}. ${clan.badgeId} __**[${escapedName}](<https://www.cwstats.com/clan/${clantagForUrl}/log>)**__\n`;
      } else {
        description += `${index + 1}. ${clan.badgeId} **[${escapedName}](<https://www.cwstats.com/clan/${clantagForUrl}/log>)**\n`;
      }
    });
  } else if (stats.type === 'warDay') {
    embed.setTitle('War Day');
    stats.clans.forEach((clan, index) => {
      const escapedName = escapeMarkdown(clan.name);
      const clantagForUrl = clan.clantag.substring(1); // Remove #
      if (clan.clantag === clantag) {
        description += `${index + 1}. ${clan.badgeId} __**[${escapedName}](<https://www.cwstats.com/clan/${clantagForUrl}/log>)**__\n`;
      } else {
        description += `${index + 1}. ${clan.badgeId} **[${escapedName}](<https://www.cwstats.com/clan/${clantagForUrl}/log>)**\n`;
      }

      // Show completion flag if boat is completed (10k+ fame)
      if (clan.isBoatCompleted) {
        description += `🏁\n\n`;
      } else {
        // Normal stats
        description += `${getEmoji('fame')} ${clan.fame.toLocaleString()}\n`;
        description += `:clipboard: ${clan.projectedFame.toLocaleString()} (${clan.projectedRank})\n`;
        description += `${getEmoji('decksLeft')} ${200 - clan.attacksUsedToday}\n`;
        description += `${getEmoji('average')} ${clan.average.toFixed(2)}\n\n`;
      }
    });
  } else if (stats.type === 'colosseum') {
    embed.setTitle('Colosseum');
    stats.clans.forEach((clan, index) => {
      const escapedName = escapeMarkdown(clan.name);
      const clantagForUrl = clan.clantag.substring(1); // Remove #

      if (clan.clantag === clantag) {
        description += `${index + 1}. ${clan.badgeId} __**[${escapedName}](<https://www.cwstats.com/clan/${clantagForUrl}/log>)**__\n`;
      } else {
        description += `${index + 1}. ${clan.badgeId} **[${escapedName}](<https://www.cwstats.com/clan/${clantagForUrl}/log>)**\n`;
      }
      description += `${getEmoji('fame')} ${clan.fame.toLocaleString()}\n`;
      description += `:clipboard: ${clan.projectedFame.toLocaleString()} (${clan.projectedRank})\n`;
      description += `${getEmoji('decksLeft')} ${200 - clan.attacksUsedToday}\n`;
      description += `${getEmoji('coloAverage')} ${clan.coloAverage.toFixed(2)}\n\n`;
    });
  }

  if (endTime) {
    description += `-# War ${stats.type === 'training' ? 'starts' : 'ends'} ~${getNextDayRelativeTimestamp(endTime)}`;
  }

  embed.setDescription(description);
  return embed;
}

function escapeMarkdown(text: string): string {
  const markdownCharacters = ['*', '_', '`', '~'];
  return text
    .split('')
    .map(function (character: string) {
      if (markdownCharacters.includes(character)) {
        return '\\' + character;
      }
      return character;
    })
    .join('');
}
