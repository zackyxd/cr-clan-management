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

/** Returns the numeric sheetId for a tab by its display name, or null if not found. */
export async function getSheetIdByName(spreadsheetId: string, sheetName: string): Promise<number | null> {
  const sheets = await getAuthenticatedSheetsClient();
  const res = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = res.data.sheets?.find((s) => s.properties?.title === sheetName);
  return sheet?.properties?.sheetId ?? null;
}

// TODO fix column name
export async function getSpreadsheetId(guildId: string): Promise<string> {
  const res = await pool.query(
    `
    SELECT "stats_spreadsheetId"
    FROM server_settings
    WHERE guild_id = $1
    `,
    [guildId],
  );
  return res.rows[0]?.stats_spreadsheetId ?? '';
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
