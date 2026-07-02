import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { makeCustomId } from '../../utils/customId.js';
import type { AveragesEntry } from './averagesLookup.js';

export const DEFAULT_WEEKS_SHOWN = 3;
export const WEEKS_OPTIONS = [3, 6, 12, 24];

function sortEntries(entries: AveragesEntry[]): AveragesEntry[] {
  return [...entries].sort((a, b) => {
    if (a.league !== b.league) return a.league === '5k' ? -1 : 1;
    return (b.average ?? -Infinity) - (a.average ?? -Infinity);
  });
}

export function buildSummaryEmbed(displayName: string, entries: AveragesEntry[]): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(`📊 Averages — ${displayName}`).setColor(EmbedColor.LOGS);

  if (entries.length === 0) {
    embed.setDescription('No average data found for any of their linked accounts.');
    return embed;
  }

  embed
    .setDescription(
      sortEntries(entries)
        .map(
          (e) =>
            `**${e.playerName}** \`${e.tag}\` — ${e.league} — **${e.average !== null ? e.average.toFixed(2) : 'N/A'}** fame/atk`,
        )
        .join('\n'),
    )
    .setFooter({ text: 'Select an account below to view recent weeks' });

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

export function buildWeeklyEmbed(entry: AveragesEntry, weeksShown: number): EmbedBuilder {
  const shownWeeks = entry.weeks.slice(0, weeksShown);

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${entry.playerName} \`${entry.tag}\` — ${entry.league} Averages`)
    .setColor(EmbedColor.LOGS)
    .addFields({
      name: 'Recent Avg (last 3 weeks)',
      value: entry.average !== null ? entry.average.toFixed(2) : 'N/A',
    });

  if (shownWeeks.length === 0) {
    embed.setDescription('No recent war weeks tracked for this account.');
  } else {
    embed.setDescription(
      shownWeeks
        .map((w) => {
          if (w.fame === null && w.attacks === null) return `**${w.label}** — No war data`;
          const fame = w.fame ?? 0;
          const attacks = w.attacks ?? 0;
          const ratio = attacks > 0 ? (fame / attacks).toFixed(1) : '0.0';
          return `**${w.label}** — ${fame.toLocaleString()} fame / ${attacks} attacks (${ratio}/atk)`;
        })
        .join('\n'),
    );
  }

  embed.setFooter({ text: `Showing ${shownWeeks.length} of ${entry.weeks.length} tracked weeks` });

  return embed;
}

export function buildWeeksButtonRow(guildId: string, entry: AveragesEntry, activeWeeksCount: number): ActionRowBuilder<ButtonBuilder> {
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
