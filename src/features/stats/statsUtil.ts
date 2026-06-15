import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import logger from '../../logger.js';
import 'dotenv-flow/config';
import { pool } from '../../db.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Create authenticated Google Sheets client
export async function getAuthenticatedSheetsClient() {
  try {
    const auth = new GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
      scopes: SCOPES,
    });

    const sheets = google.sheets({ version: 'v4', auth });
    return sheets;
  } catch (error) {
    logger.error('Failed to authenticate with Google Sheets API:', error);
    throw error;
  }
}

/** Returns the bot's service-account email, so it can be added as an editor on protected ranges it creates. */
export async function getServiceAccountEmail(): Promise<string> {
  const auth = new GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
    scopes: SCOPES,
  });
  const credentials = await auth.getCredentials();
  if (!credentials.client_email) {
    throw new Error('Service account credentials are missing client_email');
  }
  return credentials.client_email;
}

/** Returns the numeric sheetId for a tab by its display name, or null if not found. */
export async function getSheetIdByName(spreadsheetId: string, sheetName: string): Promise<number | null> {
  const sheets = await getAuthenticatedSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = res.data.sheets?.find((s) => s.properties?.title === sheetName);
  return sheet?.properties?.sheetId ?? null;
}

export async function getSpreadsheetId(guildId: string): Promise<string> {
  const res = await pool.query(
    `
    SELECT stats_spreadsheetid
    FROM server_settings
    WHERE guild_id = $1
    `,
    [guildId],
  );
  return res.rows[0]?.stats_spreadsheetid ?? '';
}

/** Converts a 0-based column index to a letter (A, B, …, Z, AA, …). */
export function colToLetter(index: number): string {
  let letter = '';
  let i = index + 1;
  while (i > 0) {
    i--;
    letter = String.fromCharCode(65 + (i % 26)) + letter;
    i = Math.floor(i / 26);
  }
  return letter;
}

// ─── Shared Sheet Layout Conventions ───────────────────────────────────────────
// Every stats sheet (Available, L2W/Inactive, Averages, etc.) follows the same
// 3-row layout: a merged title row, a header row, then data starting on row 3.

/** 0-based row index of the colored title row (row 1 in A1 notation). */
export const TITLE_ROW = 0;
/** 0-based row index of the column-header row (row 2 in A1 notation). */
export const HEADERS_ROW = 1;
/** 0-based row index where data begins (row 3 in A1 notation). */
export const DATA_START_ROW = 2;

/** Standard gray background used for column-header rows across stats sheets. */
export const HEADER_BG = { red: 0.85, green: 0.85, blue: 0.85 };

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

// ─── Shared Sheets API Request Builders ────────────────────────────────────────
// These return raw batchUpdate request objects (or arrays of them) for formatting
// patterns repeated across every stats sheet builder, so each sheet file only
// needs to describe what's different about it (colors, columns, row counts).

/** Removes an existing merge over the given range so re-running a sheet build doesn't error on "already merged" cells. */
export function buildUnmergeRequest(
  sheetId: number,
  startRowIndex: number,
  endRowIndex: number,
  startColumnIndex: number,
  endColumnIndex: number,
): object {
  return {
    unmergeCells: {
      range: { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex },
    },
  };
}

/**
 * Builds the title-row formatting: a bold, centered, colored banner across
 * [startColumnIndex, endColumnIndex), merged into one cell across
 * [mergeStartColumnIndex, endColumnIndex). Used for the colored "section header"
 * banner at the top of each sheet (e.g. "5k Available", "L2W").
 *
 * `mergeStartColumnIndex` defaults to `startColumnIndex`, but can start later —
 * e.g. the Available sheet colors the whole title row (cols 0-7) but only merges
 * cols 2-7, leaving the frozen Tag/Player columns as separate colored cells.
 */
export function buildTitleCellRequests(
  sheetId: number,
  startColumnIndex: number,
  endColumnIndex: number,
  backgroundColor: RgbColor,
  foregroundColor: RgbColor,
  mergeStartColumnIndex: number = startColumnIndex,
): object[] {
  return [
    {
      repeatCell: {
        range: { sheetId, startRowIndex: TITLE_ROW, endRowIndex: TITLE_ROW + 1, startColumnIndex, endColumnIndex },
        cell: {
          userEnteredFormat: {
            backgroundColor,
            textFormat: { bold: true, foregroundColor, fontSize: 12 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: TITLE_ROW,
          endRowIndex: TITLE_ROW + 1,
          startColumnIndex: mergeStartColumnIndex,
          endColumnIndex,
        },
        mergeType: 'MERGE_ALL',
      },
    },
  ];
}

/** Builds the gray, bold, centered formatting applied to the column-header row. */
export function buildHeaderRowRequest(sheetId: number, totalCols: number): object {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: HEADERS_ROW, endRowIndex: HEADERS_ROW + 1, startColumnIndex: 0, endColumnIndex: totalCols },
      cell: {
        userEnteredFormat: {
          backgroundColor: HEADER_BG,
          textFormat: { bold: true },
          horizontalAlignment: 'CENTER',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
    },
  };
}

/** Builds one `updateDimensionProperties` request per column to set fixed pixel widths, starting at column 0. */
export function buildColumnWidthRequests(sheetId: number, widthsByColumn: number[]): object[] {
  return widthsByColumn.map((pixelSize, i) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize },
      fields: 'pixelSize',
    },
  }));
}

/** Builds a request that freezes the title + header rows (and optionally a number of leading columns, e.g. Tag/Player). */
export function buildFreezeRequest(sheetId: number, frozenRowCount: number, frozenColumnCount?: number): object {
  const gridProperties: Record<string, number> = { frozenRowCount };
  const fields = ['gridProperties.frozenRowCount'];
  if (frozenColumnCount !== undefined) {
    gridProperties.frozenColumnCount = frozenColumnCount;
    fields.push('gridProperties.frozenColumnCount');
  }
  return {
    updateSheetProperties: {
      properties: { sheetId, gridProperties },
      fields: fields.join(', '),
    },
  };
}

/** Builds a request that applies boolean checkbox data validation to a column over a row range. */
export function buildCheckboxValidationRequest(
  sheetId: number,
  column: number,
  startRowIndex: number,
  endRowIndex: number,
): object {
  return {
    setDataValidation: {
      range: { sheetId, startRowIndex, endRowIndex, startColumnIndex: column, endColumnIndex: column + 1 },
      rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true },
    },
  };
}

/** Builds a request that strips any data validation from a column over a row range (omitting `rule` clears it). */
export function buildClearValidationRequest(
  sheetId: number,
  column: number,
  startRowIndex: number,
  endRowIndex: number,
): object {
  return {
    setDataValidation: {
      range: { sheetId, startRowIndex, endRowIndex, startColumnIndex: column, endColumnIndex: column + 1 },
    },
  };
}

/**
 * Builds requests to delete every existing conditional format rule on a sheet.
 * Indices are processed highest-to-lowest because deleting rule 0 shifts every
 * remaining rule's index down by one — deleting in reverse avoids skipping rules.
 */
export function buildClearConditionalFormatRequests(sheetId: number, ruleCount: number): object[] {
  const requests: object[] = [];
  for (let i = ruleCount - 1; i >= 0; i--) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }
  return requests;
}

/**
 * Builds a request that locks a range to a fixed list of editors. Anyone not on
 * `editorEmails` gets a hard "you don't have permission" block on edit — used
 * for bot-managed columns (formulas, computed status, autofilled values) that
 * get overwritten on every refresh, so manual edits would otherwise silently
 * get lost. Always include the bot's service account email (so refreshes keep
 * working) plus any human admins who should be able to remove the protection
 * from the Sheets UI if the bot ever gets stuck.
 */
export function buildProtectedRangeRequest(
  sheetId: number,
  range: { startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number },
  description: string,
  editorEmails: string[],
): object {
  return {
    addProtectedRange: {
      protectedRange: {
        range: { sheetId, ...range },
        description,
        editors: { users: editorEmails },
      },
    },
  };
}

/** Builds requests to remove existing protected ranges by id, so warning ranges don't pile up duplicates on rebuild. */
export function buildClearProtectedRangeRequests(protectedRangeIds: number[]): object[] {
  return protectedRangeIds.map((protectedRangeId) => ({ deleteProtectedRange: { protectedRangeId } }));
}
