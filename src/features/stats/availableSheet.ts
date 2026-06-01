import { pool } from '../../db.js';
import logger from '../../logger.js';
import { getRiverRaceLog, isFetchError } from '../../api/CR_API.js';
import { getAuthenticatedSheetsClient, getSheetIdByName } from './statsUtil.js';
import { buildGetL2WTags, buildUpsertL2WPlayer, type UpsertL2WPlayerData } from '../../sql_queries/playerL2W.js';
import {
  buildGetLeagueOverrides,
  buildUpsertLeagueAssignment,
  buildRemoveLeagueAssignment,
} from '../../sql_queries/playerLeagueAssignments.js';
import { getLeagueFromTrophies, AVAILABLE_SHEET_WEEKS_LOOKBACK } from '../../config/constants.js';

// ─── Layout Config ────────────────────────────────────────────────────────────

const COL_TAG = 0;
const COL_PLAYER = 1;
// COL_CLAN and COL_WEEKS removed
const COL_FAME_AVG = 2;
const COL_STATUS = 3;
const COL_L2W = 4; // Send to L2W sheet
const COL_INACTIVE = 5; // Send to Inactive sheet
const COL_ACTION = 6; // Demote ↓ (5k sheet) / Promote ↑ (4k sheet)
const COL_REMOVE = 7; // Remove players from being shown available (if not actual warring)

const TOTAL_COLS = 8;
const TITLE_ROW = 0;
const HEADERS_ROW = 1;
const DATA_START_ROW = 2; // 0-based; = row 3 in A1 notation

// Title background per league
const TITLE_BG_5K = { red: 0.27, green: 0.51, blue: 0.71 }; // blue (matches lineupOrder)
const TITLE_BG_4K = { red: 0.27, green: 0.65, blue: 0.4 }; // green
const TITLE_FG = { red: 1, green: 1, blue: 1 }; // white text

const HEADER_BG = { red: 0.85, green: 0.85, blue: 0.85 };

// Amber highlight for rostered rows (applied via conditional format)
const ROSTERED_BG = { red: 1.0, green: 0.87, blue: 0.4 };

// Column widths in pixels
const COL_WIDTHS = [95, 135, 80, 90, 90, 75, 75, 75];

// Matches LINEUP_BLOCK_WIDTH in lineupOrder.ts (cols per clan block including gap)
const LINEUP_BLOCK_WIDTH = 7;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParticipantEntry {
  name: string;
  /** Set of "seasonId-sectionIndex" war week keys the player participated in. */
  weeks: Set<string>;
  /** Clan tag from the most recent war week appearance. */
  latestClanTag: string;
  /** Comparable score (seasonId * 100 + sectionIndex) for recency comparison. */
  latestScore: number;
}

interface AvailablePlayer {
  playertag: string;
  playerName: string;
  weeksActive: number;
  isRostered: boolean;
  isRemoved: boolean;
  naturalLeague: '5k' | '4k' | null;
  effectiveLeague: '5k' | '4k' | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nameFormula(row: number, league: '5k' | '4k'): string {
  const primary = `${league} Averages`;
  const secondary = league === '5k' ? '4k Averages' : '5k Averages';
  return (
    `=IFERROR(XLOOKUP(A${row},'${primary}'!B:B,'${primary}'!C:C),` +
    `IFERROR(XLOOKUP(A${row},'${secondary}'!B:B,'${secondary}'!C:C),"Unknown"))`
  );
}

function clanFormula(row: number, league: '5k' | '4k'): string {
  const primary = `${league} Averages`;
  const secondary = league === '5k' ? '4k Averages' : '5k Averages';
  return (
    `=IFERROR(XLOOKUP(A${row},'${primary}'!B:B,'${primary}'!D:D),` +
    `IFERROR(XLOOKUP(A${row},'${secondary}'!B:B,'${secondary}'!D:D),"—"))`
  );
}

function fameFormula(row: number, league: '5k' | '4k'): string {
  const primary = `${league} Averages`;
  const secondary = league === '5k' ? '4k Averages' : '5k Averages';
  return (
    `=IFERROR(XLOOKUP(A${row},'${primary}'!B:B,'${primary}'!E:E),` +
    `IFERROR(XLOOKUP(A${row},'${secondary}'!B:B,'${secondary}'!E:E),"—"))`
  );
}

// ─── Data Collection ──────────────────────────────────────────────────────────

/**
 * Fetches war race logs for all provided family clans concurrently and
 * aggregates participant history into a map keyed by playertag.
 */
async function collectParticipants(
  familyClans: { clantag: string; clan_trophies: number }[],
): Promise<Map<string, ParticipantEntry>> {
  const playerMap = new Map<string, ParticipantEntry>();

  // Fetch all logs concurrently (rate-limited by Bottleneck inside getRiverRaceLog)
  const logs = await Promise.all(familyClans.map((c) => getRiverRaceLog(c.clantag)));

  for (let ci = 0; ci < familyClans.length; ci++) {
    const clan = familyClans[ci];
    const log = logs[ci];

    if (isFetchError(log)) {
      logger.warn(`[availableSheet] Failed to fetch race log for ${clan.clantag}: ${log.reason}`);
      continue;
    }

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
          });
        }

        const entry = playerMap.get(tag)!;
        entry.weeks.add(weekKey);

        if (score > entry.latestScore) {
          entry.latestScore = score;
          entry.latestClanTag = clan.clantag;
          entry.name = participant.name; // keep most recent display name
        }
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
  const linuepsSheets = (spreadsheet.data.sheets ?? []).filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => (s.properties?.title as string | undefined)?.includes('Lineups'),
  );

  const rosteredTags = new Set<string>();

  for (const sheet of linuepsSheets) {
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
          if (tag && typeof tag === 'string' && tag.startsWith('#')) {
            rosteredTags.add(tag.toUpperCase());
          }
        }
      }
    } catch {
      logger.warn(`[availableSheet] Failed to read lineups sheet "${title}"`);
    }
  }

  return rosteredTags;
}

// ─── Checkbox Processing ──────────────────────────────────────────────────────

/**
 * Reads the action checkbox column (col G) on an Available sheet, applies the
 * resulting league override changes to the DB, and returns how many were changed.
 *
 * Semantics:
 *  - 5k sheet: checking = "Demote" → create override to 4k (or undo if already overridden TO 5k)
 *  - 4k sheet: checking = "Promote" → create override to 5k (or undo if already overridden TO 4k)
 */
async function processAvailableCheckboxes(
  guildId: string,
  spreadsheetId: string,
  sheetName: string,
  league: '5k' | '4k',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: any,
): Promise<number> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A${DATA_START_ROW + 1}:G2500`, // 1-indexed, skip title + headers
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = (res.data.values ?? []) as (string | boolean | number)[][];

  // Batch-fetch existing overrides
  const overrideRes = await pool.query(buildGetLeagueOverrides(guildId));
  const overrideMap = new Map<string, string>(
    overrideRes.rows.map((r) => [r.playertag as string, r.league_target as string]),
  );

  const oppositeLeague: '5k' | '4k' = league === '5k' ? '4k' : '5k';
  let changeCount = 0;

  for (const row of rows) {
    const tag = row[COL_TAG];
    if (!tag || typeof tag !== 'string') continue;

    const playerName = typeof row[COL_PLAYER] === 'string' ? (row[COL_PLAYER] as string) : tag;
    const existingOverride = overrideMap.get(tag);

    // ── Demote/Promote action (col I) ────────────────────────────────────────
    if (row[COL_ACTION] === true) {
      if (existingOverride === league) {
        await pool.query(buildRemoveLeagueAssignment(guildId, tag));
      } else {
        await pool.query(buildUpsertLeagueAssignment(guildId, tag, playerName, oppositeLeague, league, 'system'));
      }
      changeCount++;
    }

    // ── Send to L2W (col E) ──────────────────────────────────────────────────
    if (row[COL_L2W] === true) {
      const data: UpsertL2WPlayerData = {
        playertag: tag,
        playerName,
        status: 'l2w',
        league,
        notes: null,
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
        playerName,
        status: 'inactive',
        league,
        notes: null,
        durationDate: null,
        markedByDiscordId: 'sheet',
      };
      await pool.query(buildUpsertL2WPlayer(guildId, data));
      changeCount++;
    }

    // ── Send to Removed (col H) ─────────────────────────────────────────────
    if (row[COL_REMOVE] === true) {
      console.log('remove');
      const data: UpsertL2WPlayerData = {
        playertag: tag,
        playerName,
        status: 'removed',
        league,
        notes: null,
        durationDate: null,
        markedByDiscordId: 'sheet',
      };
      await pool.query(buildUpsertL2WPlayer(guildId, data));
      changeCount++;
    }
  }

  if (changeCount > 0) {
    logger.info(`[availableSheet] Processed ${changeCount} checkbox action(s) on "${sheetName}" for guild ${guildId}`);
  }

  return changeCount;
}

// ─── Sheet Formatting & Write ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function writeAvailableSheet(
  spreadsheetId: string,
  sheetId: number,
  sheetName: string,
  league: '5k' | '4k',
  players: AvailablePlayer[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: any,
): Promise<void> {
  const titleBg = league === '5k' ? TITLE_BG_5K : TITLE_BG_4K;
  const actionHeader = league === '5k' ? 'Demote ↓' : 'Promote ↑';

  // ── 1. Clear existing values ─────────────────────────────────────────────────
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: sheetName });

  // ── 1b. Clear existing conditional format rules (prevents duplication on re-run) ──
  const sheetMeta = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [sheetName],
    fields: 'sheets.conditionalFormats',
  });
  const existingRules: unknown[] = sheetMeta.data.sheets?.[0]?.conditionalFormats ?? [];
  if (existingRules.length > 0) {
    const deleteRequests = existingRules
      .map((_: unknown, index: number) => ({ deleteConditionalFormatRule: { sheetId, index } }))
      .reverse();
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: deleteRequests } });
  }

  // ── 2. Build formatting requests ─────────────────────────────────────────────
  const requests: object[] = [];

  // Unmerge title first (safe for re-runs)
  requests.push({
    unmergeCells: {
      range: {
        sheetId,
        startRowIndex: TITLE_ROW,
        endRowIndex: TITLE_ROW + 1,
        startColumnIndex: 0,
        endColumnIndex: TOTAL_COLS,
      },
    },
  });

  // Title: colored bg, white bold text, merged across all columns
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: TITLE_ROW,
        endRowIndex: TITLE_ROW + 1,
        startColumnIndex: 0,
        endColumnIndex: TOTAL_COLS,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: titleBg,
          textFormat: { bold: true, foregroundColor: TITLE_FG, fontSize: 12 },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    },
  });
  requests.push({
    mergeCells: {
      range: {
        sheetId,
        startRowIndex: TITLE_ROW,
        endRowIndex: TITLE_ROW + 1,
        startColumnIndex: 0,
        endColumnIndex: TOTAL_COLS,
      },
      mergeType: 'MERGE_ALL',
    },
  });

  // Headers: gray bg, bold, centered
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: HEADERS_ROW,
        endRowIndex: HEADERS_ROW + 1,
        startColumnIndex: 0,
        endColumnIndex: TOTAL_COLS,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: HEADER_BG,
          textFormat: { bold: true },
          horizontalAlignment: 'CENTER',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
    },
  });

  // Data rows: center-aligned
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: DATA_START_ROW,
        endRowIndex: 1000,
        startColumnIndex: 0,
        endColumnIndex: TOTAL_COLS,
      },
      cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
      fields: 'userEnteredFormat(horizontalAlignment)',
    },
  });

  // Checkbox validation on COL_L2W, COL_INACTIVE, and COL_ACTION (data rows)
  // Clear any leftover checkbox validation beyond the current data rows
  for (const col of [COL_L2W, COL_INACTIVE, COL_ACTION, COL_REMOVE]) {
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: DATA_START_ROW,
          endRowIndex: 1000,
          startColumnIndex: col,
          endColumnIndex: col + 1,
        },
        // No rule = clears existing validation
      },
    });
  }

  // Checkbox validation only on rows that have data
  if (players.length > 0) {
    for (const col of [COL_L2W, COL_INACTIVE, COL_ACTION, COL_REMOVE]) {
      requests.push({
        setDataValidation: {
          range: {
            sheetId,
            startRowIndex: DATA_START_ROW,
            endRowIndex: DATA_START_ROW + players.length,
            startColumnIndex: col,
            endColumnIndex: col + 1,
          },
          rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true },
        },
      });
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

  // Column widths
  for (let i = 0; i < COL_WIDTHS.length; i++) {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: COL_WIDTHS[i] },
        fields: 'pixelSize',
      },
    });
  }

  // Freeze title + header rows
  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 2 } },
      fields: 'gridProperties.frozenRowCount',
    },
  });

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  // ── 3. Write values ───────────────────────────────────────────────────────────
  const titleRow = [`${league} Available`, '', '', '', '', '', ''];
  const headerRow = ['Tag', 'Player', 'Fame Avg', 'Status', '→ L2W ☑', '→ Inactive ☑', actionHeader, 'Remove'];

  const dataRows: (string | boolean | number)[][] = players.map((p, i) => {
    const sheetRow = DATA_START_ROW + i + 1; // 1-indexed A1 row number
    return [
      p.playertag,
      nameFormula(sheetRow, league),
      fameFormula(sheetRow, league),
      p.isRemoved ? 'Removed' : p.isRostered ? 'Rostered' : 'Available',
      false, // → L2W checkbox
      false, // → Inactive checkbox
      false, // Demote/Promote checkbox,
      false, // Remove from available (but not inactive/l2w)
    ];
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [titleRow, headerRow, ...dataRows] },
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Processes any checked action boxes on the sheet (updating DB league overrides),
 * then fetches live participant data and rebuilds the Available sheet from scratch.
 *
 * @param guildId       Discord guild ID
 * @param spreadsheetId Google Sheets spreadsheet ID
 * @param sheetName     Display name of the target sheet tab (e.g. "5k Available")
 * @param league        Which league tier to display ('5k' | '4k')
 */
export async function refreshAvailableSheet(
  guildId: string,
  spreadsheetId: string,
  sheetName: string,
  league: '5k' | '4k',
): Promise<void> {
  const sheets = await getAuthenticatedSheetsClient();

  const sheetId = await getSheetIdByName(spreadsheetId, sheetName);
  if (sheetId === null) {
    throw new Error(`[availableSheet] Sheet "${sheetName}" not found in spreadsheet ${spreadsheetId}`);
  }

  // 1. Process any action checkboxes first so overrides are up-to-date before the rebuild
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

  // 3. Collect participant history from CR API
  const participantMap = await collectParticipants(familyClans);
  // 4. Load L2W/inactive/removed tags
  const l2wRes = await pool.query(buildGetL2WTags(guildId));
  const l2wTags = new Set<string>(
    l2wRes.rows.filter((r) => r.l2w_status !== 'removed').map((r) => r.playertag as string),
  );
  const removedTags = new Set<string>(
    l2wRes.rows.filter((r) => r.l2w_status === 'removed').map((r) => r.playertag as string),
  );
  console.log(removedTags);
  for (const row of l2wRes.rows) {
    console.log(row.l2w_status);
  }

  // 5. Load league overrides
  const overrideRes = await pool.query(buildGetLeagueOverrides(guildId));
  const overrideMap = new Map<string, '5k' | '4k'>(
    overrideRes.rows.map((r) => [r.playertag as string, r.league_target as '5k' | '4k']),
  );

  // 6. Build a clan-trophy lookup for natural league detection
  const clanTrophyMap = new Map<string, number>(familyClans.map((c) => [c.clantag.toUpperCase(), c.clan_trophies]));

  // 7. Read tags that are already rostered on any Lineups sheet
  const rosteredTags = await readLineupsRosteredTags(sheets, spreadsheetId);

  // 8. Filter and classify players
  const players: AvailablePlayer[] = [];

  for (const [tag, entry] of participantMap) {
    const isRemoved = removedTags.has(tag);
    if (!isRemoved && l2wTags.has(tag)) continue; // exclude L2W/inactive unless removed

    const trophies = clanTrophyMap.get(entry.latestClanTag.toUpperCase()) ?? 0;
    const naturalLeague = getLeagueFromTrophies(trophies);
    const effectiveLeague = overrideMap.get(tag) ?? naturalLeague;

    if (effectiveLeague !== league) continue;

    players.push({
      playertag: tag,
      playerName: entry.name,
      weeksActive: entry.weeks.size,
      isRostered: rosteredTags.has(tag),
      isRemoved,
      naturalLeague,
      effectiveLeague,
    });
  }

  // 9. Sort: available first (most active → least), rostered last (most active → least)
  players.sort((a, b) => {
    if (a.isRemoved !== b.isRemoved) return a.isRemoved ? 1 : -1;
    if (a.isRostered !== b.isRostered) return a.isRostered ? 1 : -1;
    return b.weeksActive - a.weeksActive;
  });

  // 10. Write to sheet
  await writeAvailableSheet(spreadsheetId, sheetId, sheetName, league, players, sheets);

  logger.info(
    `[availableSheet] Refreshed "${sheetName}" for guild ${guildId}: ` +
      `${players.filter((p) => !p.isRostered).length} available, ${players.filter((p) => p.isRostered).length} rostered`,
  );
}
