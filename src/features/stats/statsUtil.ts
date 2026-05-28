import { GoogleAuth } from 'google-auth-library';
import { google } from 'googleapis';
import logger from '../../logger.js';
import 'dotenv-flow/config';

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
