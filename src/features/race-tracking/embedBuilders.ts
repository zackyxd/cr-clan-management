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

  // Format participant lines
  const lines = formatParticipantsList(
    enrichedParticipants,
    attacksData.totalAttacksRemaining,
    attacksData.availableAttackers,
    {
      mentionUsers,
    },
  );

  let description: string;
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

  const embed = new EmbedBuilder()
    .setTitle(`${attacksData.clanInfo.name}`)
    .setAuthor({
      name: `Season ${attacksData.seasonId ?? '---'} | Week ${attacksData.warWeek} | Day ${getDayForDisplay(attacksData.raceDay)}`,
    })
    .setColor(BOTCOLOR)
    .setDescription(description)
    .setURL(`https://cwstats.com/clan/${attacksData.clanInfo.clantag.substring(1)}/race`);

  if (lines.length > 0) {
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
  console.log(stats);
  if (stats.type === 'training') {
    embed.setTitle('Training Day');
    stats.clans.forEach((clan, index) => {
      const escapedName = escapeMarkdown(clan.name);
      const clantagForUrl = clan.clantag.substring(1); // Remove #

      if (clan.clantag === clantag) {
        description += `__**${index + 1}. [${escapedName}](<https://www.cwstats.com/clan/${clantagForUrl}/log>)**__\n`;
      } else {
        description += `**${index + 1}. [${escapedName}](<https://www.cwstats.com/clan/${clantagForUrl}/log>)**\n`;
      }
    });
  } else if (stats.type === 'warDay') {
    embed.setTitle('War Day');
    stats.clans.forEach((clan, index) => {
      const escapedName = escapeMarkdown(clan.name);
      const clantagForUrl = clan.clantag.substring(1); // Remove #

      if (clan.clantag === clantag) {
        description += `${index + 1}. __**[${escapedName}](<https://www.cwstats.com/clan/${clantagForUrl}/log>)**__\n`;
      } else {
        description += `${index + 1}. **[${escapedName}](<https://www.cwstats.com/clan/${clantagForUrl}/log>)**\n`;
      }
      const average: string = clan.attacksUsedToday > 0 ? (clan.fame / clan.attacksUsedToday).toFixed(2) : '0.00';
      description += `:fame: ${clan.fame.toLocaleString()}\n`;
      description += `:projected: ${clan.projectedFame.toLocaleString()} (${clan.projectedRank})\n`;
      description += `:attacksLeft: ${200 - clan.attacksUsedToday}\n`;
      description += `:average: ${average}\n\n`;
    });
  } else if (stats.type === 'colosseum') {
    embed.setTitle('Colosseum');
    stats.clans.forEach((clan, index) => {
      const escapedName = escapeMarkdown(clan.name);
      const clantagForUrl = clan.clantag.substring(1); // Remove #

      if (clan.clantag === clantag) {
        description += `${index + 1}. __**[${escapedName}](<https://www.cwstats.com/clan/${clantagForUrl}/log>)**__\n`;
      } else {
        description += `${index + 1}. **[${escapedName}](<https://www.cwstats.com/clan/${clantagForUrl}/log>)**\n`;
      }
      const average: string = clan.attacksUsedToday > 0 ? (clan.fame / clan.attacksUsedToday).toFixed(2) : '0.00';
      description += `:fame: ${clan.fame.toLocaleString()}\n`;
      description += `:projected: ${clan.projectedFame.toLocaleString()} (${clan.projectedRank})\n`;
      description += `:attacksLeft: ${200 - clan.attacksUsedToday}\n`;
      description += `:average: ${average}\n\n`;
    });
  }

  if (endTime) {
    description += `-# War ends ~${getNextDayRelativeTimestamp(endTime)}`;
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
