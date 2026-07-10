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
  /** Only weeks the player actually scored in, newest first — blank/missed weeks are skipped. */
  weeks: AveragesWeek[];
}

export interface AveragesSheetData {
  league: '5k' | '4k';
  /** Week header labels (e.g. "133-2"), newest first. */
  weekLabels: string[];
  entries: AveragesEntry[];
}

/**
 * Reads every row of the 5k/4k Averages sheets. A sheet missing from the
 * guild's spreadsheet is simply omitted from the result.
 */
export async function readAveragesSheets(spreadsheetId: string): Promise<AveragesSheetData[]> {
  const sheets = await getAuthenticatedSheetsClient();
  const result: AveragesSheetData[] = [];

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

    const entries: AveragesEntry[] = [];
    for (const row of dataRows) {
      const rawTag = row[COL_TAG];
      if (!rawTag) continue;
      const tag = normalizeTag(String(rawTag));

      const avgRaw = row[COL_AVERAGE];
      const average = typeof avgRaw === 'number' ? avgRaw : avgRaw ? Number(avgRaw) : null;

      // Walk every tracked week (newest first), but only keep ones this player actually
      // has a score for — a player can miss a war, so "3 most recent weeks" may span
      // more than 3 calendar weeks once blanks are skipped.
      const weeks: AveragesWeek[] = weekLabels
        .map((label, weekIndex) => {
          const fameCol = WEEK_START_COL + weekIndex * 2;
          const attacksCol = fameCol + 1;
          const fameRaw = row[fameCol];
          const attacksRaw = row[attacksCol];
          return {
            label,
            fame: fameRaw === '' || fameRaw === undefined || fameRaw === null ? null : Number(fameRaw),
            attacks: attacksRaw === '' || attacksRaw === undefined || attacksRaw === null ? null : Number(attacksRaw),
          };
        })
        .filter((week) => week.fame !== null)
        .slice(0, MAX_WEEKS_LOOKUP);

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

    result.push({ league, weekLabels, entries });
  }

  return result;
}

/**
 * Reads the 5k/4k Averages sheets and returns one entry per (league, tag) match.
 * A player active in clans of both leagues during the lookback window can
 * legitimately appear on both sheets, so the same tag may produce two entries.
 */
export async function getAveragesEntriesForTags(spreadsheetId: string, tags: string[]): Promise<AveragesEntry[]> {
  const wantedTags = new Set(tags.map((t) => normalizeTag(t)));
  if (wantedTags.size === 0) return [];

  const sheetData = await readAveragesSheets(spreadsheetId);
  return sheetData.flatMap((sheet) => sheet.entries.filter((entry) => wantedTags.has(entry.tag)));
}
