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
  125, // duration
  100,
  100,
  90, // L2W section (0–7)
  20, // gap (8)
  95,
  135,
  100,
  200,
  125, // duration
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

function formatDurationDays(
  durationDays: number | null | undefined,
  durationDate: string | null,
  markedAt: string | Date | null,
): number | '' {
  if (typeof durationDays === 'number' && Number.isFinite(durationDays)) {
    return Math.max(0, Math.floor(durationDays));
  }

  if (!durationDate || !markedAt) return '';

  const expiryDate = new Date(durationDate);
  const markedDate = new Date(markedAt);
  if (Number.isNaN(expiryDate.getTime()) || Number.isNaN(markedDate.getTime())) return '';

  // Compare DATE granularity so the sheet shows an integer day duration.
  const expiryDateOnly = new Date(toIsoDate(expiryDate));
  const markedDateOnly = new Date(toIsoDate(markedDate));
  const msPerDay = 24 * 60 * 60 * 1000;
  const dayDiff = Math.round((expiryDateOnly.getTime() - markedDateOnly.getTime()) / msPerDay);

  return Math.max(0, dayDiff);
}

function formatDate(dateValue: string | Date): string {
  return new Date(dateValue).toISOString().split('T')[0];
}

function toIsoDate(value: Date): string {
  return value.toISOString().split('T')[0];
}

function parseSheetDateValue(value: unknown): Date | null {
  if (value == null) return null;

  // Google Sheets serial date (days since 1899-12-30).
  const fromSerial = (serial: number): Date | null => {
    if (!Number.isFinite(serial)) return null;
    const epochMs = Date.UTC(1899, 11, 30);
    return new Date(epochMs + Math.round(serial * 24 * 60 * 60 * 1000));
  };

  if (typeof value === 'number') {
    return fromSerial(value);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (Number.isFinite(serial)) {
      const epochMs = Date.UTC(1899, 11, 30);
      return new Date(epochMs + Math.round(serial * 24 * 60 * 60 * 1000));
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

function normalizeSheetDurationDate(durationCellValue: unknown, markedDateCellValue: unknown): string | null {
  if (durationCellValue == null) return null;

  const raw = String(durationCellValue).trim();
  if (!raw || raw.toLowerCase() === 'indefinite') return null;

  const markedDate = parseSheetDateValue(markedDateCellValue);
  const hasValidMarkedDate = markedDate !== null;

  // If duration is numeric (days), convert to absolute expiry DATE for DB storage.
  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber) && hasValidMarkedDate) {
    const expiry = new Date(markedDate);
    expiry.setDate(expiry.getDate() + asNumber);
    return toIsoDate(expiry);
  }

  // Numeric duration without a valid marked date cannot be converted safely.
  if (!Number.isNaN(asNumber)) {
    return null;
  }

  // If it's already a date-like value, normalize to ISO date.
  const asDate = new Date(raw);
  if (!Number.isNaN(asDate.getTime())) {
    return toIsoDate(asDate);
  }

  return null;
}

function normalizeSheetDurationDays(durationCellValue: unknown): number | null {
  if (durationCellValue == null) return null;

  const raw = String(durationCellValue).trim();
  if (!raw || raw.toLowerCase() === 'indefinite') return null;

  const asNumber = Number(raw);
  if (!Number.isFinite(asNumber)) return null;
  return Math.max(0, Math.floor(asNumber));
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

  const totalChanges = returnedTags.length + switchedToInactive.length + switchedToL2W.length;
  if (totalChanges > 0) {
    logger.info(
      `[l2wSheet] Processed checkboxes for guild ${guildId}: ` +
        `${returnedTags.length} returned, ${switchedToInactive.length} → inactive, ${switchedToL2W.length} → l2w`,
    );
  }

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
  processCheckboxes = true,
): Promise<void> {
  const sheets = await getAuthenticatedSheetsClient();

  // Apply checkbox actions first so all reads below use latest DB state in same rebuild.
  if (processCheckboxes) {
    await processL2WSheetCheckboxes(guildId, spreadsheetId, sheetName, league);
  }

  // Read grid size so unmerge can safely target the whole sheet, including any legacy merged ranges.
  const spreadsheetMeta = await sheets.spreadsheets.get({ spreadsheetId });
  const targetSheet = spreadsheetMeta.data.sheets?.find((s) => s.properties?.sheetId === sheetId);
  const targetSheetProps = targetSheet?.properties;
  const gridRowCount = targetSheetProps?.gridProperties?.rowCount ?? 1000;
  const gridColumnCount = targetSheetProps?.gridProperties?.columnCount ?? TOTAL_COLS;
  const existingConditionalRuleCount = targetSheet?.conditionalFormats?.length ?? 0;

  const effectiveColumnCount = Math.max(gridColumnCount, TOTAL_COLS);

  // Read sheet values first so we can persist notes/duration to DB before querying for render.
  // This ensures the DB query below sees the values the user just typed in, not the previous ones.
  const initialResult = await pool.query(buildGetL2WPlayers(guildId, league));
  const initialPlayers: L2WPlayerRow[] = initialResult.rows;
  const initialMaxRows = Math.max(
    initialPlayers.filter((p) => p.l2w_status === 'l2w').length,
    initialPlayers.filter((p) => p.l2w_status === 'inactive').length,
    0,
  );

  // Map of normalized tag → player row for players currently active in the DB.
  // Used to guard note-saving upserts: only save for active players, and use their
  // current DB status (not the section they appear in on the old sheet). This prevents:
  //   - Removed players being re-added (they're absent from the map)
  //   - Switched players (L2W ↔ Inactive) having their new status overwritten
  const activePlayerMap = new Map(
    initialPlayers.map((p) => [p.playertag.toUpperCase().replace('#', ''), p]),
  );

  // Keep notes — read from sheet before any DB queries so user edits are captured.
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A${DATA_START_ROW + 1}:Q${DATA_START_ROW + Math.max(initialMaxRows, 1)}`, // 1-indexed
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = response.data.values ?? [];
  for (const row of rows) {
    if (row[L2W_TAG_COL] === 'Tag' || row[INACTIVE_TAG_COL] === 'Tag') continue; // skip header
    const l2wTag = row[L2W_TAG_COL];
    const l2wNotes = row[L2W_NOTES_COL];
    const l2wName = row[L2W_PLAYER_COL];
    const l2wDurationDays = normalizeSheetDurationDays(row[L2W_DURATION_COL]);
    const l2wDurationDate = normalizeSheetDurationDate(row[L2W_DURATION_COL], row[L2W_DATE_COL]);
    const hasL2WNotes = typeof l2wNotes === 'string' && l2wNotes.trim().length > 0;
    const l2wTagNorm = l2wTag ? String(l2wTag).trim().toUpperCase().replace('#', '') : '';
    const l2wActivePlayer = activePlayerMap.get(l2wTagNorm);
    if (l2wActivePlayer && (hasL2WNotes || l2wDurationDays !== null || l2wDurationDate !== null)) {
      await pool.query(
        buildUpsertL2WPlayer(guildId, {
          playertag: l2wTag,
          playerName: l2wName || '',
          status: l2wActivePlayer.l2w_status,
          league,
          notes: hasL2WNotes ? l2wNotes.trim() : null,
          durationDays: l2wDurationDays,
          durationDate: l2wDurationDate,
          markedByDiscordId: 'sheet',
        }),
      );
    }
    const inactiveTag = row[INACTIVE_TAG_COL];
    const inactiveNotes = row[INACTIVE_NOTES_COL];
    const inactiveName = row[INACTIVE_PLAYER_COL];
    const inactiveDurationDays = normalizeSheetDurationDays(row[INACTIVE_DURATION_COL]);
    const inactiveDurationDate = normalizeSheetDurationDate(row[INACTIVE_DURATION_COL], row[INACTIVE_DATE_COL]);
    const hasInactiveNotes = typeof inactiveNotes === 'string' && inactiveNotes.trim().length > 0;
    const inactiveTagNorm = inactiveTag ? String(inactiveTag).trim().toUpperCase().replace('#', '') : '';
    const inactiveActivePlayer = activePlayerMap.get(inactiveTagNorm);
    if (
      inactiveActivePlayer &&
      (hasInactiveNotes || inactiveDurationDays !== null || inactiveDurationDate !== null)
    ) {
      await pool.query(
        buildUpsertL2WPlayer(guildId, {
          playertag: inactiveTag,
          playerName: inactiveName || '',
          status: inactiveActivePlayer.l2w_status,
          league,
          notes: hasInactiveNotes ? inactiveNotes.trim() : null,
          durationDays: inactiveDurationDays,
          durationDate: inactiveDurationDate,
          markedByDiscordId: 'sheet',
        }),
      );
    }
  }

  // Re-query DB after sheet→DB upserts so render uses values the user just typed, not the previous snapshot.
  const result = await pool.query(buildGetL2WPlayers(guildId, league));
  const allPlayers: L2WPlayerRow[] = result.rows;

  const l2wPlayers = allPlayers.filter((p) => p.l2w_status === 'l2w');
  const inactivePlayers = allPlayers.filter((p) => p.l2w_status === 'inactive');
  const maxRows = Math.max(l2wPlayers.length, inactivePlayers.length, 0);
  const firstDataRowOneBased = DATA_START_ROW + 1;
  const effectiveRowCount = Math.max(gridRowCount, DATA_START_ROW + Math.max(maxRows, 1), 1000);

  // ── 1. Clear all existing values ────────────────────────────────────────────
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: sheetName });

  // ── 2. Apply formatting + checkbox validation ────────────────────────────────
  const requests: object[] = [];

  // Unmerge entire sheet first so any legacy/partial merged ranges do not break rebuild.
  requests.push({
    unmergeCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: gridRowCount,
        startColumnIndex: 0,
        endColumnIndex: gridColumnCount,
      },
    },
  });

  // Ensure grid is large enough for formatting/data-validation ranges (especially on brand-new or shrunk sheets).
  if (gridRowCount < effectiveRowCount) {
    requests.push({
      appendDimension: {
        sheetId,
        dimension: 'ROWS',
        length: effectiveRowCount - gridRowCount,
      },
    });
  }
  if (gridColumnCount < effectiveColumnCount) {
    requests.push({
      appendDimension: {
        sheetId,
        dimension: 'COLUMNS',
        length: effectiveColumnCount - gridColumnCount,
      },
    });
  }

  // Remove existing conditional formatting rules so they do not duplicate on rebuild.
  for (let i = existingConditionalRuleCount - 1; i >= 0; i--) {
    requests.push({
      deleteConditionalFormatRule: {
        sheetId,
        index: i,
      },
    });
  }

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

  // Conditional formatting for duration: light red background if duration date is in the future (still on L2W/Inactive)
  requests.push({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: DATA_START_ROW,
            endRowIndex: effectiveRowCount,
            startColumnIndex: 0,
            endColumnIndex: L2W_SWITCH_COL + 1,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [
              {
                userEnteredValue: `=AND($${colToLetter(L2W_DURATION_COL)}${firstDataRowOneBased}<>"",$${colToLetter(L2W_DATE_COL)}${firstDataRowOneBased}<>"",NOW()<$${colToLetter(L2W_DURATION_COL)}${firstDataRowOneBased}+$${colToLetter(L2W_DATE_COL)}${firstDataRowOneBased})`,
              },
            ],
          },
          format: { backgroundColor: { red: 0.957, green: 0.78, blue: 0.765 } }, // Light red
        },
      },
    },
  });

  // Same conditional formatting for l2w section but for finished
  requests.push({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: DATA_START_ROW,
            endRowIndex: effectiveRowCount,
            startColumnIndex: 0,
            endColumnIndex: L2W_SWITCH_COL + 1,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [
              {
                userEnteredValue: `=AND($${colToLetter(L2W_DURATION_COL)}${firstDataRowOneBased}<>"",$${colToLetter(L2W_DATE_COL)}${firstDataRowOneBased}<>"",NOW()>=$${colToLetter(L2W_DURATION_COL)}${firstDataRowOneBased}+$${colToLetter(L2W_DATE_COL)}${firstDataRowOneBased})`,
              },
            ],
          },
          format: { backgroundColor: { red: 0.718, green: 0.882, blue: 0.804 } }, // Light green
        },
      },
    },
  });

  // Conditional formatting for inactive: light red background if inactive date is in the future (still on L2W/Inactive)
  requests.push({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: DATA_START_ROW,
            endRowIndex: effectiveRowCount,
            startColumnIndex: INACTIVE_TAG_COL,
            endColumnIndex: INACTIVE_SWITCH_COL + 1,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [
              {
                userEnteredValue: `=AND($${colToLetter(INACTIVE_DURATION_COL)}${firstDataRowOneBased}<>"",$${colToLetter(INACTIVE_DATE_COL)}${firstDataRowOneBased}<>"",NOW()<$${colToLetter(INACTIVE_DURATION_COL)}${firstDataRowOneBased}+$${colToLetter(INACTIVE_DATE_COL)}${firstDataRowOneBased})`,
              },
            ],
          },
          format: { backgroundColor: { red: 0.957, green: 0.78, blue: 0.765 } }, // Light red
        },
      },
    },
  });

  // Same conditional formatting for inactive section but for finished
  requests.push({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: DATA_START_ROW,
            endRowIndex: effectiveRowCount,
            startColumnIndex: INACTIVE_TAG_COL,
            endColumnIndex: INACTIVE_SWITCH_COL + 1,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [
              {
                userEnteredValue: `=AND($${colToLetter(INACTIVE_DURATION_COL)}${firstDataRowOneBased}<>"",$${colToLetter(INACTIVE_DATE_COL)}${firstDataRowOneBased}<>"",NOW()>=$${colToLetter(INACTIVE_DURATION_COL)}${firstDataRowOneBased}+$${colToLetter(INACTIVE_DATE_COL)}${firstDataRowOneBased})`,
              },
            ],
          },
          format: { backgroundColor: { red: 0.718, green: 0.882, blue: 0.804 } }, // Light green
        },
      },
    },
  });

  // Checkbox data validation on all action columns (data rows only)
  for (const col of [L2W_RETURN_COL, L2W_SWITCH_COL, INACTIVE_RETURN_COL, INACTIVE_SWITCH_COL]) {
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: DATA_START_ROW,
          endRowIndex: effectiveRowCount,
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

  const l2wHeaders = ['Tag', 'Player', 'Notes', '', 'Duration (days)', 'Date Marked', '↩ Available', '→ Inactive'];
  const inactiveHeaders = ['Tag', 'Player', 'Notes', '', 'Duration (days)', 'Date Marked', '↩ Available', '→ L2W'];
  const headerRow: string[] = [...l2wHeaders, '', ...inactiveHeaders];

  const dataRows: (string | number | boolean)[][] = [];
  for (let i = 0; i < maxRows; i++) {
    const sheetRow = DATA_START_ROW + i + 1; // 1-indexed sheet row number
    const row: (string | number | boolean)[] = Array(TOTAL_COLS).fill('') as string[];

    const l2w = l2wPlayers[i];
    if (l2w) {
      row[L2W_TAG_COL] = l2w.playertag;
      row[L2W_PLAYER_COL] = nameFormula(l2wTagLetter, sheetRow);
      // row[L2W_CLAN_COL] = clanFormula(l2wTagLetter, sheetRow);
      row[L2W_NOTES_COL] = l2w.l2w_notes ?? '';
      row[L2W_DURATION_COL] = formatDurationDays(l2w.l2w_duration_days, l2w.l2w_duration_date, l2w.l2w_marked_at);
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
      row[INACTIVE_DURATION_COL] = formatDurationDays(
        inactive.l2w_duration_days,
        inactive.l2w_duration_date,
        inactive.l2w_marked_at,
      );
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
