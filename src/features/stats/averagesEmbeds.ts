import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { royaleApiLink } from '../../api/CR_API.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { makeCustomId } from '../../utils/customId.js';
import type { AveragesEntry } from './averagesLookup.js';

export const DEFAULT_WEEKS_SHOWN = 3;
export const WEEKS_OPTIONS = [3, 6, 12, 24];
const MAX_ACCOUNTS_PER_LEAGUE = 5;

function sortEntries(entries: AveragesEntry[]): AveragesEntry[] {
  return [...entries].sort((a, b) => {
    if (a.league !== b.league) return a.league === '5k' ? -1 : 1;
    return (b.average ?? -Infinity) - (a.average ?? -Infinity);
  });
}

export function buildSummaryEmbed(displayName: string, avatarURL: string, entries: AveragesEntry[]): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(`Averages — ${displayName}`).setColor(EmbedColor.LOGS);

  if (entries.length === 0) {
    embed.setDescription('No average data found for any of their linked accounts.');
    return embed;
  }

  for (const league of ['5k', '4k'] as const) {
    const leagueEntries = entries
      .filter((e) => e.league === league)
      .sort((a, b) => (b.average ?? -Infinity) - (a.average ?? -Infinity));

    if (leagueEntries.length === 0) continue;

    const shown = leagueEntries.slice(0, MAX_ACCOUNTS_PER_LEAGUE);
    const lines = shown.map(
      (e, i) => `${i + 1}. ${royaleApiLink(e.playerName, e.tag)} (${e.average !== null ? e.average.toFixed(2) : 'N/A'})`,
    );
    if (leagueEntries.length > shown.length) {
      lines.push(`*+${leagueEntries.length - shown.length} more*`);
    }

    embed.addFields({ name: `${league} Averages`, value: lines.join('\n') });
  }

  embed.setFooter({ text: 'Select an account below to view recent weeks.', iconURL: avatarURL });

  return embed;
}

export function buildAccountSelectRow(
  guildId: string,
  entries: AveragesEntry[],
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  if (entries.length === 0) return null;

  const select = new StringSelectMenuBuilder()
    .setCustomId(makeCustomId('s', 'average_select', guildId))
    .setPlaceholder('Select an account for recent weeks');

  for (const entry of sortEntries(entries)) {
    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(entry.playerName)
        .setDescription(`${entry.league} • ${entry.tag}`)
        .setValue(entry.key),
    );
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

export function buildWeeklyEmbed(entry: AveragesEntry, weeksShown: number, avatarURL: string): EmbedBuilder {
  const shownWeeks = entry.weeks.slice(0, weeksShown);

  // Recompute from the shown weeks (rather than entry.average, which is always the
  // sheet's fixed 3-week formula) so the average actually reflects the 6/12/24w view.
  const totalFame = shownWeeks.reduce((sum, w) => sum + (w.fame ?? 0), 0);
  const totalAttacks = shownWeeks.reduce((sum, w) => sum + (w.attacks ?? 0), 0);
  const average = totalAttacks > 0 ? totalFame / totalAttacks : 0;

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${entry.league} Averages`)
    .setColor(EmbedColor.LOGS)
    .setDescription(royaleApiLink(entry.playerName, entry.tag))
    .addFields(
      { name: `Average (last ${shownWeeks.length})`, value: shownWeeks.length > 0 ? average.toFixed(2) : 'N/A', inline: false },
      ...shownWeeks.map((w) => ({
        name: w.label,
        value: `${w.fame ?? 0}/${w.attacks ?? 0}`,
        inline: true,
      })),
    )
    .setFooter({ text: `Showing ${shownWeeks.length} of ${entry.weeks.length} tracked weeks`, iconURL: avatarURL });

  return embed;
}

export function buildWeeksButtonRow(
  guildId: string,
  entry: AveragesEntry,
  activeWeeksCount: number,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  for (const weeksCount of WEEKS_OPTIONS) {
    const available = entry.weeks.length >= weeksCount;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(makeCustomId('b', 'average_weeks', guildId, { extra: [entry.key, String(weeksCount)] }))
        .setLabel(`${weeksCount}w`)
        .setStyle(weeksCount === activeWeeksCount ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setDisabled(!available || weeksCount === activeWeeksCount),
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(makeCustomId('b', 'average_summary', guildId))
      .setLabel('◀ Summary')
      .setStyle(ButtonStyle.Secondary),
  );

  return row;
}
