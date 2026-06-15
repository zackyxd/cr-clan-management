import { pool } from '../../db.js';
import logger from '../../logger.js';
import { getCurrentRiverRace, getRiverRaceLog, getPlayer, isFetchError, normalizeTag } from '../../api/CR_API.js';
import {
  colToLetter,
  getAuthenticatedSheetsClient,
  getServiceAccountEmail,
  getSheetIdByName,
  TITLE_ROW,
  DATA_START_ROW,
  buildUnmergeRequest,
  buildTitleCellRequests,
  buildHeaderRowRequest,
  buildColumnWidthRequests,
  buildFreezeRequest,
  buildCheckboxValidationRequest,
  buildClearValidationRequest,
  buildClearConditionalFormatRequests,
  buildProtectedRangeRequest,
  buildClearProtectedRangeRequests,
} from './statsUtil.js';
import {
  buildGetL2WTags,
  buildUpsertL2WPlayer,
  buildBatchUpdateNotes,
  type UpsertL2WPlayerData,
} from '../../sql_queries/playerL2W.js';
import { getLeagueFromTrophies, AVAILABLE_SHEET_WEEKS_LOOKBACK, PROTECTED_RANGE_ADMIN_EMAILS } from '../../config/constants.js';
import { averagesFameFormula, averagesNameFormula } from '../../commands/stats_commands/stats.js';

// ─── Layout Config ────────────────────────────────────────────────────────────

const COL_TAG = 0;
const COL_PLAYER = 1;
const COL_FAME_AVG = 2;
const COL_STATUS = 3;
const COL_L2W = 4; // Send to L2W sheet
const COL_INACTIVE = 5; // Send to Inactive sheet
const COL_REMOVE = 6; // Remove player from available list
const COL_NOTES = 7; // Notes — scoped per player per league

const TOTAL_COLS = 8;

// Title background colors indexed by league key
const TITLE_BG_BY_LEAGUE: Record<string, { red: number; green: number; blue: number }> = {
  '5k': { red: 0.27, green: 0.51, blue: 0.71 }, // blue
  '4k': { red: 0.27, green: 0.65, blue: 0.4 }, // green
  '3k': { red: 0.8, green: 0.5, blue: 0.2 }, // orange
};
const TITLE_BG_DEFAULT = { red: 0.5, green: 0.5, blue: 0.5 }; // gray fallback
const TITLE_FG = { red: 1, green: 1, blue: 1 }; // white text

// Amber highlight for rostered rows (applied via conditional format)
const ROSTERED_BG = { red: 1.0, green: 0.87, blue: 0.4 };

// Column widths in pixels (notes column wider for text)
const COL_WIDTHS = [95, 135, 80, 90, 90, 90, 90, 200];

// Matches LINEUP_BLOCK_WIDTH in lineupOrder.ts (cols per clan block including gap)
const LINEUP_BLOCK_WIDTH = 7;
const AVERAGES_WEEK_START_COL = 5;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParticipantEntry {
  name: string;
  /** Set of "seasonId-sectionIndex" war week keys the player participated in. */
  weeks: Set<string>;
  /** Clan tag from the most recent war week appearance. */
  latestClanTag: string;
  /** Comparable score (seasonId * 100 + sectionIndex) for recency comparison. */
  latestScore: number;
  /**
   * All league tiers this player participated in during the lookback window.
   * A player active in both a 5k and a 4k clan will appear on both Available sheets.
   */
  leagues: Set<string>;
}

interface AvailablePlayer {
  playertag: string;
  playerName: string;
  weeksActive: number;
  isRostered: boolean;
  isRemoved: boolean;
  notes: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Always checks 5k Averages first, then 4k Averages, regardless of which sheet we're writing. */
function nameFormula(row: number): string {
  return (
    `=IFERROR(XLOOKUP(A${row},'5k Averages'!B:B,'5k Averages'!C:C),` +
    `IFERROR(XLOOKUP(A${row},'4k Averages'!B:B,'4k Averages'!C:C),"—"))`
  );
}

function fameFormula(row: number): string {
  return (
    `=IFERROR(XLOOKUP(A${row},'5k Averages'!B:B,'5k Averages'!E:E),` +
    `IFERROR(XLOOKUP(A${row},'4k Averages'!B:B,'4k Averages'!E:E),"—"))`
  );
}

function buildAveragesFameFormula(rowNumber: number, lastWeekColLetter: string): string {
  return (
    `=IFERROR(LET(` +
    `r,INDIRECT("F${rowNumber}:${lastWeekColLetter}${rowNumber}"),` +
    `f,ARRAY_CONSTRAIN(FILTER(r,MOD(COLUMN(r)-COLUMN($F$1),2)=0,r<>""),1,3),` +
    `a,ARRAY_CONSTRAIN(FILTER(r,MOD(COLUMN(r)-COLUMN($F$1),2)=1,r<>""),1,3),` +
    `IF(COUNTA(r)=0,0,SUM(f)/MAX(1,SUM(a)))` +
    `),0)`
  );
}

async function ensureSheetRowCapacity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: any,
  spreadsheetId: string,
  sheetId: number,
  requiredRows: number,
): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,gridProperties(rowCount)))',
  });

  const targetSheet = meta.data.sheets?.find(
    (sheet: { properties?: { sheetId?: number } }) => sheet.properties?.sheetId === sheetId,
  );
  const currentRows = targetSheet?.properties?.gridProperties?.rowCount ?? 0;
  if (requiredRows <= currentRows) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          appendDimension: {
            sheetId,
            dimension: 'ROWS',
            length: requiredRows - currentRows,
          },
        },
      ],
    },
  });
}

async function backfillRosteredNamesToAverages(
  spreadsheetId: string,
  league: string,
  rosteredTags: Set<string>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: any,
): Promise<void> {
  if (rosteredTags.size === 0) return;

  const sheetName = `${league} Averages`;
  const sheetId = await getSheetIdByName(spreadsheetId, sheetName);
  if (sheetId === null) return;

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!F1:1`,
  });
  const currentHeaderRow = headerResponse.data.values?.[0] ?? [];
  const existingWeekCount = currentHeaderRow.filter((label: string) => !!label).length;
  const totalWeekColCount = existingWeekCount * 2;
  const lastWeekColLetter = totalWeekColCount > 0 ? colToLetter(AVERAGES_WEEK_START_COL + totalWeekColCount - 1) : 'E';

  const existingRowsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A2:ZZ`,
  });
  const existingRows = existingRowsResponse.data.values ?? [];
  const existingTags = new Set<string>();
  for (const row of existingRows) {
    const rawTag = row[1];
    if (!rawTag) continue;
    const tag = normalizeTag(String(rawTag));
    if (tag) existingTags.add(tag);
  }

  const missingTags = [...rosteredTags].filter((tag) => !existingTags.has(tag));
  if (missingTags.length === 0) return;

  const linkedRes = await pool.query<{ playertag: string; discord_id: string }>(
    `SELECT playertag, discord_id FROM user_playertags WHERE playertag = ANY($1)`,
    [missingTags],
  );
  const linkedDiscordIds = new Map(linkedRes.rows.map((row) => [normalizeTag(row.playertag), row.discord_id] as const));

  const players = await Promise.all(missingTags.map((tag) => getPlayer(tag)));
  const appendRows: (string | number)[][] = [];
  let appendCount = 0;
  for (let i = 0; i < missingTags.length; i++) {
    const tag = missingTags[i];
    const player = players[i];
    if (isFetchError(player)) continue;
    appendCount++;
    const rowNumber = existingRows.length + appendCount + 1;
    const linkedDiscord = linkedDiscordIds.get(tag) ?? '';
    appendRows.push([
      linkedDiscord,
      tag,
      player.name,
      '',
      totalWeekColCount > 0 ? buildAveragesFameFormula(rowNumber, lastWeekColLetter) : '',
    ]);
  }

  if (appendRows.length === 0) return;

  const requiredRows = existingRows.length + appendRows.length + 1;
  await ensureSheetRowCapacity(sheets, spreadsheetId, sheetId, requiredRows);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A${existingRows.length + 2}:E${existingRows.length + 1 + appendRows.length}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: appendRows },
  });
}

// ─── Data Collection ──────────────────────────────────────────────────────────

/**
 * Fetches war race logs for all provided family clans concurrently and
 * aggregates participant history into a map keyed by playertag.
 *
 * Each entry's `leagues` set contains every league tier the player appeared in
 * during the lookback window, so they can be shown on multiple Available sheets.
 */
async function collectParticipants(
  familyClans: { clantag: string; clan_trophies: number }[],
): Promise<Map<string, ParticipantEntry>> {
  const playerMap = new Map<string, ParticipantEntry>();

  // Fetch all logs/current races concurrently (rate-limited by Bottleneck inside API helpers)
  const [logs, currentRaces] = await Promise.all([
    Promise.all(familyClans.map((c) => getRiverRaceLog(c.clantag))),
    Promise.all(familyClans.map((c) => getCurrentRiverRace(c.clantag))),
  ]);

  for (let ci = 0; ci < familyClans.length; ci++) {
    const clan = familyClans[ci];
    const log = logs[ci];
    const currentRace = currentRaces[ci];

    const clanLeague = getLeagueFromTrophies(clan.clan_trophies);

    if (isFetchError(log)) {
      logger.warn(`[availableSheet] Failed to fetch race log for ${clan.clantag}: ${log.reason}`);
    } else {
      const recentItems = log.items.slice(0, AVAILABLE_SHEET_WEEKS_LOOKBACK);

      for (const item of recentItems) {
        const weekKey = `${item.seasonId}-${item.sectionIndex}`;
        const score = item.seasonId * 100 + item.sectionIndex;

        // Find this guild's clan in the standings
        const standing = item.standings.find((s) => s.clan.tag.toUpperCase() === clan.clantag.toUpperCase());
        if (!standing) continue;

        for (const participant of standing.clan.participants) {
          const tag = participant.tag.toUpperCase();

          if (!playerMap.has(tag)) {
            playerMap.set(tag, {
              name: participant.name,
              weeks: new Set(),
              latestClanTag: clan.clantag,
              latestScore: score,
              leagues: new Set(),
            });
          }

          const entry = playerMap.get(tag)!;
          entry.weeks.add(weekKey);
          if (clanLeague) entry.leagues.add(clanLeague);

          if (score > entry.latestScore) {
            entry.latestScore = score;
            entry.latestClanTag = clan.clantag;
            entry.name = participant.name; // keep most recent display name
          }
        }
      }
    }

    if (isFetchError(currentRace)) {
      logger.warn(`[availableSheet] Failed to fetch current race for ${clan.clantag}: ${currentRace.reason}`);
      continue;
    }

    const currentParticipants = currentRace.clan?.participants ?? [];
    const currentScore = Number.MAX_SAFE_INTEGER;

    for (const participant of currentParticipants) {
      const tag = participant.tag.toUpperCase();

      if (!playerMap.has(tag)) {
        playerMap.set(tag, {
          name: participant.name,
          weeks: new Set(),
          latestClanTag: clan.clantag,
          latestScore: currentScore,
          leagues: new Set(),
        });
      }

      const entry = playerMap.get(tag)!;
      if (clanLeague) entry.leagues.add(clanLeague);

      if (currentScore > entry.latestScore) {
        entry.latestScore = currentScore;
        entry.latestClanTag = clan.clantag;
        entry.name = participant.name;
      }
    }
  }

  return playerMap;
}

/**
 * Reads all sheets whose title contains "Lineups" and returns the set of
 * player tags that are currently written in any tag column.
 * Tag columns in each Lineups sheet are at 0-based indices 1, 8, 15, 22, …
 * (i.e. blockIndex * LINEUP_BLOCK_WIDTH + 1).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readLineupsRosteredTags(sheets: any, spreadsheetId: string): Promise<Set<string>> {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const lineupsSheets = (spreadsheet.data.sheets ?? []).filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => (s.properties?.title as string | undefined)?.includes('Lineups'),
  );

  const rosteredTags = new Set<string>();

  for (const sheet of lineupsSheets) {
    const title: string = sheet.properties.title;
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: title,
        valueRenderOption: 'UNFORMATTED_VALUE',
      });

      const rows = (res.data.values ?? []) as (string | boolean | number)[][];

      // Skip title row (0) and headers row (1); data starts at row index 2
      for (const row of rows.slice(DATA_START_ROW)) {
        // Tag columns: 1, 8, 15, 22, ...
        for (let col = 1; col < row.length; col += LINEUP_BLOCK_WIDTH) {
          const tag = row[col];
          if (tag && typeof tag === 'string') {
            const normalizedTag = normalizeTag(tag);
            rosteredTags.add(normalizedTag);
          }
        }
      }
    } catch (error) {
      logger.warn(`[availableSheet] Failed to read lineups sheet "${title}": ${error}`);
    }
  }

  return rosteredTags;
}

// ─── Checkbox & Notes Processing ─────────────────────────────────────────────

/**
 * Reads all action checkboxes and the notes column from the Available sheet,
 * applies status changes to the DB (L2W / Inactive / Removed), and batch-saves
 * any notes that were typed into the sheet for players that already have a
 * player_availability record for this league.
 */
async function processAvailableCheckboxes(
  guildId: string,
  spreadsheetId: string,
  sheetName: string,
  league: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: any,
): Promise<void> {
  let changeCount = 0;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A${DATA_START_ROW + 1}:H2500`, // includes notes column (H)
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = (res.data.values ?? []) as (string | boolean | number)[][];
  const noteUpdates: { tag: string; playerName: string; notes: string | null }[] = [];

  for (const row of rows) {
    const tag = row[COL_TAG];
    if (!tag || typeof tag !== 'string') continue;

    const playerName = typeof row[COL_PLAYER] === 'string' ? (row[COL_PLAYER] as string) : tag;
    const notesRaw = row[COL_NOTES];
    const notes = typeof notesRaw === 'string' && notesRaw.trim() !== '' ? notesRaw.trim() : null;

    // Always track notes for the batch upsert
    noteUpdates.push({ tag, playerName, notes });

    // Order matters here.
    // ── Remove from available (col G) ────────────────────────────────────────
    if (row[COL_REMOVE] === true) {
      const data: UpsertL2WPlayerData = {
        playertag: tag,
        league,
        playerName,
        status: 'removed',
        notes,
        durationDays: null,
        durationDate: null,
        markedByDiscordId: 'sheet',
      };
      await pool.query(buildUpsertL2WPlayer(guildId, data));
      changeCount++;
    } else if (row[COL_STATUS] === 'Removed' && row[COL_REMOVE] === false) {
      const data: UpsertL2WPlayerData = {
        playertag: tag,
        league,
        playerName,
        status: null,
        notes,
        durationDays: null,
        durationDate: null,
        markedByDiscordId: 'sheet',
      };
      await pool.query(buildUpsertL2WPlayer(guildId, data));
      changeCount++;
    }

    // ── Send to L2W (col E) ──────────────────────────────────────────────────
    if (row[COL_L2W] === true) {
      const data: UpsertL2WPlayerData = {
        playertag: tag,
        league,
        playerName,
        status: 'l2w',
        notes,
        durationDays: null,
        durationDate: null,
        markedByDiscordId: 'sheet',
      };
      await pool.query(buildUpsertL2WPlayer(guildId, data));
      changeCount++;
    }

    // ── Send to Inactive (col F) ─────────────────────────────────────────────
    if (row[COL_INACTIVE] === true) {
      const data: UpsertL2WPlayerData = {
        playertag: tag,
        league,
        playerName,
        status: 'inactive',
        notes,
        durationDays: null,
        durationDate: null,
        markedByDiscordId: 'sheet',
      };
      await pool.query(buildUpsertL2WPlayer(guildId, data));
      changeCount++;
    }
  }

  // Batch-upsert notes so missing player_availability rows are created automatically.
  const notesQuery = buildBatchUpdateNotes(guildId, league, noteUpdates);
  if (notesQuery) {
    await pool.query(notesQuery.text, notesQuery.values);
  }

  return changeCount;
}

// ─── Sheet Formatting & Write ─────────────────────────────────────────────────

async function writeAvailableSheet(
  spreadsheetId: string,
  sheetId: number,
  sheetName: string,
  league: string,
  players: AvailablePlayer[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: any,
): Promise<void> {
  const titleBg = TITLE_BG_BY_LEAGUE[league] ?? TITLE_BG_DEFAULT;
  const protectedRangeEditors = [await getServiceAccountEmail(), ...PROTECTED_RANGE_ADMIN_EMAILS];

  // ── 1. Clear existing values ─────────────────────────────────────────────────
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: sheetName });

  // ── 1b. Clear existing conditional format rules + protected ranges (prevents duplication on re-run) ──
  const sheetMeta = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [sheetName],
    fields: 'sheets.conditionalFormats,sheets.protectedRanges.protectedRangeId',
  });
  const existingRules: unknown[] = sheetMeta.data.sheets?.[0]?.conditionalFormats ?? [];
  const existingProtections: { protectedRangeId?: number }[] = sheetMeta.data.sheets?.[0]?.protectedRanges ?? [];
  const clearRequests = [
    ...buildClearConditionalFormatRequests(sheetId, existingRules.length),
    ...buildClearProtectedRangeRequests(existingProtections.map((p) => p.protectedRangeId!)),
  ];
  if (clearRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: clearRequests } });
  }

  // ── 2. Build formatting requests ─────────────────────────────────────────────
  const requests: object[] = [];

  // Unmerge title first (safe for re-runs)
  requests.push(buildUnmergeRequest(sheetId, TITLE_ROW, TITLE_ROW + 1, 0, TOTAL_COLS));

  // Title: colored bg (per league) across the whole row, white bold text, but
  // merged starting after the frozen Tag/Player columns so freezing 2 columns
  // doesn't split a merged cell.
  requests.push(...buildTitleCellRequests(sheetId, 0, TOTAL_COLS, titleBg, TITLE_FG, 2));

  // Headers: gray bg, bold, centered
  requests.push(buildHeaderRowRequest(sheetId, TOTAL_COLS));

  // Data rows: center-aligned (all columns)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: DATA_START_ROW,
        endRowIndex: 1500,
        startColumnIndex: 0,
        endColumnIndex: TOTAL_COLS,
      },
      cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
      fields: 'userEnteredFormat(horizontalAlignment)',
    },
  });

  // Notes column: left-aligned, wrap text
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: DATA_START_ROW,
        endRowIndex: 1500,
        startColumnIndex: COL_NOTES,
        endColumnIndex: COL_NOTES + 1,
      },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: 'LEFT',
          wrapStrategy: 'WRAP',
        },
      },
      fields: 'userEnteredFormat(horizontalAlignment,wrapStrategy)',
    },
  });

  // Clear any leftover checkbox validation beyond the current data rows (e.g. if
  // the player list shrank since the last refresh, stale checkboxes lower down
  // would otherwise remain interactive).
  for (const col of [COL_L2W, COL_INACTIVE, COL_REMOVE]) {
    requests.push(buildClearValidationRequest(sheetId, col, DATA_START_ROW, 1500));
  }

  // Re-apply checkbox validation only on rows that currently have data
  if (players.length > 0) {
    for (const col of [COL_L2W, COL_INACTIVE, COL_REMOVE]) {
      requests.push(buildCheckboxValidationRequest(sheetId, col, DATA_START_ROW, DATA_START_ROW + players.length));
    }
  }

  // Conditional format: amber bg on entire row when Status = "Rostered"
  // Formula anchors col D ($D) and lets row number float per row; row 3 = first data row in A1
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: DATA_START_ROW,
            endRowIndex: 2500,
            startColumnIndex: 0,
            endColumnIndex: TOTAL_COLS,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [{ userEnteredValue: `=$D${DATA_START_ROW + 1}="Rostered"` }],
          },
          format: { backgroundColor: ROSTERED_BG },
        },
      },
      index: 0,
    },
  });

  // Conditional format: red bg on entire row when Status = 'Removed'
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: DATA_START_ROW,
            endRowIndex: 2500,
            startColumnIndex: 0,
            endColumnIndex: TOTAL_COLS,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [{ userEnteredValue: `=$D${DATA_START_ROW + 1}="Removed"` }],
          },
          format: { backgroundColor: { red: 1, green: 0.7, blue: 0.7 } }, // light red
        },
      },
      index: 0,
    },
  });

  // Locked: Tag, Player, Fame Avg, and Status (cols A-D) are all written by
  // the bot on every refresh (Tag from the API, Player/Fame Avg via XLOOKUP
  // formulas, Status derived from rostered/removed state) — manual edits here
  // get silently overwritten on the next refresh, so editing is blocked.
  requests.push(
    buildProtectedRangeRequest(
      sheetId,
      { startRowIndex: DATA_START_ROW, endRowIndex: 2500, startColumnIndex: COL_TAG, endColumnIndex: COL_STATUS + 1 },
      'Auto-generated by /stats — edits here are overwritten on the next refresh.',
      protectedRangeEditors,
    ),
  );

  // Column widths
  requests.push(...buildColumnWidthRequests(sheetId, COL_WIDTHS));

  // Freeze title + header rows, and the Tag/Player columns
  requests.push(buildFreezeRequest(sheetId, 2, 2));

  // Fame Avg column (C): force a 2-decimal numeric display for the XLOOKUP'd average
  requests.push({
    repeatCell: {
      range: {
        sheetId: sheetId,
        startRowIndex: 1,
        endRowIndex: 2000,
        startColumnIndex: 2, // Column C
        endColumnIndex: 3,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: 'NUMBER', pattern: '##0.00' },
        },
      },
      fields: 'userEnteredFormat(numberFormat)',
    },
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  // ── 3. Write values ───────────────────────────────────────────────────────────
  const titleRow = ['', '', `${league} Available`, '', '', '', '', ''];
  const headerRow = ['Tag', 'Player', 'Fame Avg', 'Status', '→ L2W ☑', '→ Inactive ☑', '→ Remove ☑', 'Notes'];

  const dataRows: (string | boolean | null)[][] = players.map((p, i) => {
    const sheetRow = DATA_START_ROW + i + 1; // 1-indexed A1 row number
    return [
      p.playertag,
      averagesNameFormula(colToLetter(COL_TAG), sheetRow),
      averagesFameFormula(colToLetter(COL_TAG), sheetRow, league as '5k' | '4k'),
      p.isRemoved ? 'Removed' : p.isRostered ? 'Rostered' : 'Available',
      false, // → L2W checkbox
      false, // → Inactive checkbox
      p.isRemoved ? true : false, // → Remove checkbox
      p.notes ?? '', // Notes (editable; saved back to DB on next refresh)
    ];
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [titleRow, headerRow, ...dataRows] },
  });

  // ── 4. Sort each status group (Available / Rostered / Removed) independently
  // by Fame Avg, without letting rows move between groups ────────────────────
  // `players` is already ordered Available → Rostered → Removed (see sort in
  // refreshAvailableSheet), so the groups form contiguous row blocks.
  const availableCount = players.filter((p) => !p.isRemoved && !p.isRostered).length;
  const rosteredCount = players.filter((p) => !p.isRemoved && p.isRostered).length;
  const removedCount = players.filter((p) => p.isRemoved).length;

  const sortRequests: object[] = [];
  let groupStart = DATA_START_ROW;
  for (const groupCount of [availableCount, rosteredCount, removedCount]) {
    if (groupCount > 1) {
      sortRequests.push({
        sortRange: {
          range: {
            sheetId,
            startRowIndex: groupStart,
            endRowIndex: groupStart + groupCount,
            startColumnIndex: 0,
            endColumnIndex: TOTAL_COLS,
          },
          sortSpecs: [{ dimensionIndex: COL_FAME_AVG, sortOrder: 'DESCENDING' }],
        },
      });
    }
    groupStart += groupCount;
  }

  if (sortRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: sortRequests } });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Processes any checked action boxes and edited notes on the sheet (saving to DB),
 * then fetches live participant data and rebuilds the Available sheet from scratch.
 *
 * Players appear on a league sheet if they participated in at least one clan belonging
 * to that league during the recent lookback window.  A player active in both a 5k and
 * a 4k clan will appear on both sheets independently.
 *
 * Notes are scoped per-player per-league.
 *
 * @param guildId       Discord guild ID
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param sheetName     Display name of the target sheet tab (e.g. "5k Available")
 * @param league        Which league tier to display (e.g. '5k', '4k', '3k')
 */
export async function refreshAvailableSheet(
  guildId: string,
  spreadsheetId: string,
  sheetName: string,
  league: string,
): Promise<void> {
  const sheets = await getAuthenticatedSheetsClient();

  const sheetId = await getSheetIdByName(spreadsheetId, sheetName);
  if (sheetId === null) {
    throw new Error(`[availableSheet] Sheet "${sheetName}" not found in spreadsheet ${spreadsheetId}`);
  }

  // 1. Process action checkboxes and save notes from sheet to DB before rebuild
  await processAvailableCheckboxes(guildId, spreadsheetId, sheetName, league, sheets);

  // 2. Fetch family clans for this guild
  const clanRes = await pool.query<{ clantag: string; clan_trophies: number }>(
    `SELECT clantag, clan_trophies FROM clans WHERE guild_id = $1 AND family_clan = true`,
    [guildId],
  );
  const familyClans = clanRes.rows;

  if (familyClans.length === 0) {
    logger.warn(`[availableSheet] No family clans found for guild ${guildId} — writing empty sheet`);
  }

  // 3. Collect participant history from CR API (includes per-player league sets)
  const participantMap = await collectParticipants(familyClans);

  // 4. Load L2W/inactive/removed tags and their notes from DB
  // TODO ?
  const l2wRes = await pool.query(buildGetL2WTags(guildId, league));
  const notesRes = await pool.query<{ playertag: string; l2w_notes: string | null }>(
    `SELECT playertag, l2w_notes
     FROM player_availability
     WHERE guild_id = $1 AND league = $2 AND l2w_notes IS NOT NULL`,
    [guildId, league],
  );
  const l2wTags = new Set<string>(
    l2wRes.rows.filter((r) => r.l2w_status !== 'removed').map((r) => r.playertag as string),
  );
  const removedTags = new Set<string>(
    l2wRes.rows.filter((r) => r.l2w_status === 'removed').map((r) => r.playertag as string),
  );
  // Notes are league-scoped.
  const notesMap = new Map<string, string>(notesRes.rows.map((r) => [r.playertag as string, r.l2w_notes as string]));

  // 5. Read tags already rostered on any Lineups sheet
  const rosteredTags = await readLineupsRosteredTags(sheets, spreadsheetId);

  // 5b. Backfill missing rostered names into averages so lineups show names
  await backfillRosteredNamesToAverages(spreadsheetId, league, rosteredTags, sheets);

  // 6. Filter and classify players for this league sheet
  const players: AvailablePlayer[] = [];

  for (const [tag, entry] of participantMap) {
    const isRemoved = removedTags.has(tag);
    if (!isRemoved && l2wTags.has(tag)) continue; // exclude L2W/inactive unless marked removed

    // Include only players who participated in at least one clan of the target league
    if (!entry.leagues.has(league)) continue;

    players.push({
      playertag: tag,
      playerName: entry.name,
      weeksActive: entry.weeks.size,
      isRostered: rosteredTags.has(tag),
      isRemoved,
      notes: notesMap.get(tag) ?? null,
    });
  }

  // 7. Sort: available first (most active → least), rostered next, removed last
  players.sort((a, b) => {
    if (a.isRemoved !== b.isRemoved) return a.isRemoved ? 1 : -1;
    if (a.isRostered !== b.isRostered) return a.isRostered ? 1 : -1;
    return b.weeksActive - a.weeksActive;
  });

  // 8. Write to sheet
  await writeAvailableSheet(spreadsheetId, sheetId, sheetName, league, players, sheets);
}
