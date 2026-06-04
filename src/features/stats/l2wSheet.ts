import { pool } from '../../db.js';
import logger from '../../logger.js';
import {
  buildGetL2WPlayers,
  buildUpsertL2WPlayer,
  buildUpdateL2WStatus,
  buildBatchRemoveL2WPlayers,
  type L2WPlayerRow,
  type UpsertL2WPlayerData,
} from '../../sql_queries/playerL2W.js';
import { getAuthenticatedSheetsClient, colToLetter } from './statsUtil.js';

// ─── Layout Config ────────────────────────────────────────────────────────────

// Left section: L2W (cols 0–7)
const L2W_TAG_COL = 0;
const L2W_PLAYER_COL = 1;
// const L2W_CLAN_COL = 2;
const L2W_NOTES_COL = 2; // Merge with 2-3
const L2W_DURATION_COL = 4;
const L2W_DATE_COL = 5;
const L2W_RETURN_COL = 6; // ↩ Available checkbox
const L2W_SWITCH_COL = 7; // → Inactive checkbox

// Gap separator (col 8)
const GAP_COL = 8;

// Right section: Inactive (cols 9–16)
const INACTIVE_TAG_COL = 9;
const INACTIVE_PLAYER_COL = 10;
// const INACTIVE_CLAN_COL = 11;
const INACTIVE_NOTES_COL = 11; // Merge with 11-12
const INACTIVE_DURATION_COL = 13;
const INACTIVE_DATE_COL = 14;
const INACTIVE_RETURN_COL = 15; // ↩ Available checkbox
const INACTIVE_SWITCH_COL = 16; // → L2W checkbox

const SECTION_COLS = 8;
const TOTAL_COLS = 17; // 8 + 1 gap + 8

// Row indices (0-based)
const TITLE_ROW = 0;
const HEADERS_ROW = 1;
const DATA_START_ROW = 2;

// Section colors
const L2W_TITLE_BG = { red: 0.98, green: 0.8, blue: 0.2 }; // yellow
const INACTIVE_TITLE_BG = { red: 1.0, green: 0.6, blue: 0.2 }; // orange
const HEADER_BG = { red: 0.85, green: 0.85, blue: 0.85 };

// Column widths (pixels) for all 17 cols
const COL_WIDTHS = [
  95,
  135,
  100,
  200,
  90,
  100,
  100,
  90, // L2W section (0–7)
  20, // gap (8)
  95,
  135,
  100,
  200,
  90,
  100,
  100,
  90, // Inactive section (9–16)
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nameFormula(tagColLetter: string, row: number): string {
  return (
    `=IFERROR(XLOOKUP(${tagColLetter}${row},'5k Averages'!B:B,'5k Averages'!C:C),` +
    `IFERROR(XLOOKUP(${tagColLetter}${row},'4k Averages'!B:B,'4k Averages'!C:C),"Unknown"))`
  );
}

function clanFormula(tagColLetter: string, row: number): string {
  return (
    `=IFERROR(XLOOKUP(${tagColLetter}${row},'5k Averages'!B:B,'5k Averages'!D:D),` +
    `IFERROR(XLOOKUP(${tagColLetter}${row},'4k Averages'!B:B,'4k Averages'!D:D),"—"))`
  );
}

function formatDuration(durationDate: string | null): string {
  return durationDate ?? 'Indefinite';
}

function formatDate(dateValue: string | Date): string {
  return new Date(dateValue).toISOString().split('T')[0];
}

// ─── Checkbox processing ──────────────────────────────────────────────────────

export interface L2WCheckboxResult {
  returnedTags: string[];
  switchedToInactive: string[];
  switchedToL2W: string[];
}

/**
 * Reads the L2W | Inactive sheet's checkbox columns, applies the resulting
 * status changes to the DB, and returns which tags were affected.
 * Must be called BEFORE buildL2WSheet so the sheet is re-rendered from clean DB state.
 */
export async function processL2WSheetCheckboxes(
  guildId: string,
  spreadsheetId: string,
  sheetName: string,
  league: '5k' | '4k',
): Promise<L2WCheckboxResult> {
  const sheets = await getAuthenticatedSheetsClient();

  // Read data rows only (skip title + header rows), using UNFORMATTED_VALUE to get real booleans
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A${DATA_START_ROW + 1}:Q2000`, // 1-indexed
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const returnedTags: string[] = [];
  const switchedToInactive: string[] = [];
  const switchedToL2W: string[] = [];

  for (const row of rows) {
    const l2wTag = row[L2W_TAG_COL] as string | undefined;
    const inactiveTag = row[INACTIVE_TAG_COL] as string | undefined;

    if (l2wTag) {
      if (row[L2W_RETURN_COL] === true) {
        returnedTags.push(l2wTag);
      } else if (row[L2W_SWITCH_COL] === true) {
        switchedToInactive.push(l2wTag);
      }
    }

    if (inactiveTag) {
      if (row[INACTIVE_RETURN_COL] === true) {
        returnedTags.push(inactiveTag);
      } else if (row[INACTIVE_SWITCH_COL] === true) {
        switchedToL2W.push(inactiveTag);
      }
    }
  }

  // Apply DB changes
  if (returnedTags.length > 0) {
    await pool.query(buildBatchRemoveL2WPlayers(guildId, league, returnedTags));
  }
  for (const tag of switchedToInactive) {
    await pool.query(buildUpdateL2WStatus(guildId, tag, league, 'inactive'));
  }
  for (const tag of switchedToL2W) {
    await pool.query(buildUpdateL2WStatus(guildId, tag, league, 'l2w'));
  }

  logger.info(
    `[l2wSheet] Processed checkboxes for guild ${guildId}: ` +
      `${returnedTags.length} returned, ${switchedToInactive.length} → inactive, ${switchedToL2W.length} → l2w`,
  );

  return { returnedTags, switchedToInactive, switchedToL2W };
}

// ─── Sheet builder ────────────────────────────────────────────────────────────

/**
 * Rebuilds the L2W | Inactive sheet from DB state.
 * Clears existing content first so stale rows from a previous write are removed.
 */
export async function buildL2WSheet(
  guildId: string,
  spreadsheetId: string,
  sheetId: number,
  sheetName: string,
  league: '5k' | '4k',
): Promise<void> {
  const sheets = await getAuthenticatedSheetsClient();

  const result = await pool.query(buildGetL2WPlayers(guildId, league));
  const allPlayers: L2WPlayerRow[] = result.rows;

  const l2wPlayers = allPlayers.filter((p) => p.l2w_status === 'l2w');
  const inactivePlayers = allPlayers.filter((p) => p.l2w_status === 'inactive');
  const maxRows = Math.max(l2wPlayers.length, inactivePlayers.length, 0);

  const { returnedTags } = await processL2WSheetCheckboxes(guildId, spreadsheetId, sheetName, league);

  // If any players returned, we need to re-fetch the updated data for those tags to get their names for the sheet
  const removedSet = new Set(returnedTags);

  // Keep notes
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A${DATA_START_ROW + 1}:Q${DATA_START_ROW + maxRows}`, // 1-indexed
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = response.data.values ?? [];
  for (const row of rows) {
    if (row[L2W_TAG_COL] === 'Tag' || row[INACTIVE_TAG_COL] === 'Tag') continue; // skip header
    const l2wTag = row[L2W_TAG_COL];
    const l2wNotes = row[L2W_NOTES_COL];
    const l2wName = row[L2W_PLAYER_COL];
    if (l2wTag && !removedSet.has(l2wTag) && l2wNotes && typeof l2wNotes === 'string' && l2wNotes.trim()) {
      await pool.query(
        buildUpsertL2WPlayer(guildId, {
          playertag: l2wTag,
          playerName: l2wName || '',
          status: 'l2w',
          league,
          notes: l2wNotes.trim(),
          durationDate: null,
          markedByDiscordId: 'sheet',
        }),
      );
    }
    const inactiveTag = row[INACTIVE_TAG_COL];
    const inactiveNotes = row[INACTIVE_NOTES_COL];
    const inactiveName = row[INACTIVE_PLAYER_COL];
    if (
      inactiveTag &&
      !removedSet.has(inactiveTag) &&
      inactiveNotes &&
      typeof inactiveNotes === 'string' &&
      inactiveNotes.trim()
    ) {
      await pool.query(
        buildUpsertL2WPlayer(guildId, {
          playertag: inactiveTag,
          playerName: inactiveName || '',
          status: 'inactive',
          league,
          notes: inactiveNotes.trim(),
          durationDate: null,
          markedByDiscordId: 'sheet',
        }),
      );
    }
  }

  // ── 1. Clear all existing values ────────────────────────────────────────────
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: sheetName });

  // ── 2. Apply formatting + checkbox validation ────────────────────────────────
  const requests: object[] = [];

  // Unmerge the title row first (handles re-runs without "already merged" error)
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

  // L2W title cell: yellow
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: TITLE_ROW,
        endRowIndex: TITLE_ROW + 1,
        startColumnIndex: 0,
        endColumnIndex: SECTION_COLS,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: L2W_TITLE_BG,
          textFormat: { bold: true, foregroundColor: { red: 0, green: 0, blue: 0 }, fontSize: 12 },
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
        endColumnIndex: SECTION_COLS,
      },
      mergeType: 'MERGE_ALL',
    },
  });

  // Inactive title cell: orange
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: TITLE_ROW,
        endRowIndex: TITLE_ROW + 1,
        startColumnIndex: INACTIVE_TAG_COL,
        endColumnIndex: TOTAL_COLS,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: INACTIVE_TITLE_BG,
          textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 12 },
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
        startColumnIndex: INACTIVE_TAG_COL,
        endColumnIndex: TOTAL_COLS,
      },
      mergeType: 'MERGE_ALL',
    },
  });

  // Column headers row
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

  // Checkbox data validation on all action columns (data rows only)
  for (const col of [L2W_RETURN_COL, L2W_SWITCH_COL, INACTIVE_RETURN_COL, INACTIVE_SWITCH_COL]) {
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: DATA_START_ROW,
          endRowIndex: 1000,
          startColumnIndex: col,
          endColumnIndex: col + 1,
        },
        rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true },
      },
    });
  }

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

  // Merge notes columns (2-3 and 11-12) for all data rows (handles re-runs without "already merged" error)
  requests.push({
    mergeCells: {
      range: {
        sheetId,
        startRowIndex: HEADERS_ROW,
        endRowIndex: HEADERS_ROW + 1,
        startColumnIndex: L2W_NOTES_COL,
        endColumnIndex: L2W_NOTES_COL + 2, // 2 and 3
      },
      mergeType: 'MERGE_ALL',
    },
  });
  requests.push({
    mergeCells: {
      range: {
        sheetId,
        startRowIndex: HEADERS_ROW,
        endRowIndex: HEADERS_ROW + 1,
        startColumnIndex: INACTIVE_NOTES_COL,
        endColumnIndex: INACTIVE_NOTES_COL + 2, // 11 and 12
      },
      mergeType: 'MERGE_ALL',
    },
  });

  // Merge Notes columns for each data row (L2W and Inactive sections)
  for (let i = 0; i < maxRows; i++) {
    const rowIdx = DATA_START_ROW + i;
    // L2W Notes (cols 2-3)
    requests.push({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: rowIdx,
          endRowIndex: rowIdx + 1,
          startColumnIndex: L2W_NOTES_COL,
          endColumnIndex: L2W_NOTES_COL + 2,
        },
        mergeType: 'MERGE_ALL',
      },
    });
    // Inactive Notes (cols 11-12)
    requests.push({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: rowIdx,
          endRowIndex: rowIdx + 1,
          startColumnIndex: INACTIVE_NOTES_COL,
          endColumnIndex: INACTIVE_NOTES_COL + 2,
        },
        mergeType: 'MERGE_ALL',
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });

  // ── 3. Write values ──────────────────────────────────────────────────────────
  const l2wTagLetter = colToLetter(L2W_TAG_COL); // 'A'
  const inactiveTagLetter = colToLetter(INACTIVE_TAG_COL); // 'J'

  const titleRow = Array(TOTAL_COLS).fill('') as string[];
  titleRow[L2W_TAG_COL] = 'L2W';
  titleRow[INACTIVE_TAG_COL] = 'Inactive';

  const l2wHeaders = ['Tag', 'Player', 'Notes', '', 'Duration', 'Date Marked', '↩ Available', '→ Inactive'];
  const inactiveHeaders = ['Tag', 'Player', 'Notes', '', 'Duration', 'Date Marked', '↩ Available', '→ L2W'];
  const headerRow: string[] = [...l2wHeaders, '', ...inactiveHeaders];

  const dataRows: (string | boolean)[][] = [];
  for (let i = 0; i < maxRows; i++) {
    const sheetRow = DATA_START_ROW + i + 1; // 1-indexed sheet row number
    const row: (string | boolean)[] = Array(TOTAL_COLS).fill('') as string[];

    const l2w = l2wPlayers[i];
    if (l2w) {
      row[L2W_TAG_COL] = l2w.playertag;
      row[L2W_PLAYER_COL] = nameFormula(l2wTagLetter, sheetRow);
      // row[L2W_CLAN_COL] = clanFormula(l2wTagLetter, sheetRow);
      row[L2W_NOTES_COL] = l2w.l2w_notes ?? '';
      row[L2W_DURATION_COL] = formatDuration(l2w.l2w_duration_date);
      row[L2W_DATE_COL] = formatDate(l2w.l2w_marked_at);
      row[L2W_RETURN_COL] = false;
      row[L2W_SWITCH_COL] = false;
    }

    const inactive = inactivePlayers[i];
    if (inactive) {
      row[INACTIVE_TAG_COL] = inactive.playertag;
      row[INACTIVE_PLAYER_COL] = nameFormula(inactiveTagLetter, sheetRow);
      // row[INACTIVE_CLAN_COL] = clanFormula(inactiveTagLetter, sheetRow);
      row[INACTIVE_NOTES_COL] = inactive.l2w_notes ?? '';
      row[INACTIVE_DURATION_COL] = formatDuration(inactive.l2w_duration_date);
      row[INACTIVE_DATE_COL] = formatDate(inactive.l2w_marked_at);
      row[INACTIVE_RETURN_COL] = false;
      row[INACTIVE_SWITCH_COL] = false;
    }

    dataRows.push(row);
  }

  const values = [titleRow, headerRow, ...dataRows];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });

  logger.info(
    `[l2wSheet] Rebuilt sheet "${sheetName}" for guild ${guildId}: ${l2wPlayers.length} L2W, ${inactivePlayers.length} inactive`,
  );
}

// ─── Exported helpers used by commands ────────────────────────────────────────

export type { L2WPlayerRow, UpsertL2WPlayerData };
