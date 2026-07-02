import { normalizeTag } from '../../api/CR_API.js';
import { getAuthenticatedSheetsClient } from './statsUtil.js';

// Layout matches the '5k Averages' / '4k Averages' sheets built in stats.ts:
// A=Discord, B=Tag, C=Player, D=Last Clan, E=Fame/Atk avg formula, F+ = week pairs (fame, attacks),
// newest week first, one header label per pair on the header row.
const AVERAGES_SHEETS: { league: '5k' | '4k'; sheetName: string }[] = [
  { league: '5k', sheetName: '5k Averages' },
  { league: '4k', sheetName: '4k Averages' },
];

const COL_TAG = 1;
const COL_PLAYER = 2;
const COL_CLAN_ABBR = 3;
const COL_AVERAGE = 4;
const WEEK_START_COL = 5;

export const MAX_WEEKS_LOOKUP = 24;

export interface AveragesWeek {
  label: string;
  fame: number | null;
  attacks: number | null;
}

export interface AveragesEntry {
  key: string; // `${league}|${tag}`
  league: '5k' | '4k';
  tag: string;
  playerName: string;
  clanAbbr: string;
  average: number | null;
  weeks: AveragesWeek[]; // newest first
}

/**
 * Reads the 5k/4k Averages sheets and returns one entry per (league, tag) match.
 * A player active in clans of both leagues during the lookback window can
 * legitimately appear on both sheets, so the same tag may produce two entries.
 */
export async function getAveragesEntriesForTags(spreadsheetId: string, tags: string[]): Promise<AveragesEntry[]> {
  const wantedTags = new Set(tags.map((t) => normalizeTag(t)));
  if (wantedTags.size === 0) return [];

  const sheets = await getAuthenticatedSheetsClient();
  const entries: AveragesEntry[] = [];

  for (const { league, sheetName } of AVERAGES_SHEETS) {
    let headerRow: unknown[];
    let dataRows: unknown[][];
    try {
      const [headerRes, dataRes] = await Promise.all([
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sheetName}'!F1:1`,
          valueRenderOption: 'UNFORMATTED_VALUE',
        }),
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sheetName}'!A2:ZZ`,
          valueRenderOption: 'UNFORMATTED_VALUE',
        }),
      ]);
      headerRow = headerRes.data.values?.[0] ?? [];
      dataRows = dataRes.data.values ?? [];
    } catch {
      // Sheet may not exist for this guild's spreadsheet — skip it.
      continue;
    }

    const weekLabels: string[] = [];
    for (let i = 0; i < headerRow.length; i += 2) {
      if (headerRow[i]) weekLabels.push(String(headerRow[i]));
    }

    for (const row of dataRows) {
      const rawTag = row[COL_TAG];
      if (!rawTag) continue;
      const tag = normalizeTag(String(rawTag));
      if (!wantedTags.has(tag)) continue;

      const avgRaw = row[COL_AVERAGE];
      const average = typeof avgRaw === 'number' ? avgRaw : avgRaw ? Number(avgRaw) : null;

      const weeks: AveragesWeek[] = weekLabels.slice(0, MAX_WEEKS_LOOKUP).map((label, weekIndex) => {
        const fameCol = WEEK_START_COL + weekIndex * 2;
        const attacksCol = fameCol + 1;
        const fameRaw = row[fameCol];
        const attacksRaw = row[attacksCol];
        return {
          label,
          fame: fameRaw === '' || fameRaw === undefined || fameRaw === null ? null : Number(fameRaw),
          attacks: attacksRaw === '' || attacksRaw === undefined || attacksRaw === null ? null : Number(attacksRaw),
        };
      });

      entries.push({
        key: `${league}|${tag}`,
        league,
        tag,
        playerName: typeof row[COL_PLAYER] === 'string' && row[COL_PLAYER] ? (row[COL_PLAYER] as string) : tag,
        clanAbbr: typeof row[COL_CLAN_ABBR] === 'string' ? (row[COL_CLAN_ABBR] as string) : '',
        average: average !== null && !Number.isNaN(average) ? average : null,
        weeks,
      });
    }
  }

  return entries;
}
