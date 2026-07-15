import { sheets_v4 } from 'googleapis';
import { pool } from '../../db.js';
import logger from '../../logger.js';
import { normalizeTag } from '../../api/CR_API.js';
import { colToLetter, getAuthenticatedSheetsClient, getSheetIdByName } from './statsUtil.js';

const LINEUP_BLOCK_WIDTH = 7;
const LINEUP_DATA_ROWS = 52;
// Cur. Clan is the 5th column (index 4) within each clan block.
const CUR_CLAN_COL_OFFSET = 4;
const DEFAULT_INTERVAL_MINUTES = 5;

export class LineupsAutofillScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  private getIntervalMs(): number {
    const parsed = Number(process.env.CUR_CLAN_AUTOFILL_INTERVAL_MINUTES ?? DEFAULT_INTERVAL_MINUTES);
    const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MINUTES;
    return minutes * 60 * 1000;
  }

  start() {
    if (this.intervalId) return;

    const intervalMs = this.getIntervalMs();
    logger.info(`Starting cur-clan autofill scheduler (every ${Math.round(intervalMs / 60000)} minutes)`);

    this.intervalId = setInterval(() => {
      void this.runCycle();
    }, intervalMs);

    void this.runCycle();
  }

  stop() {
    if (!this.intervalId) return;
    clearInterval(this.intervalId);
    this.intervalId = null;
    logger.info('Stopped lineups autofill scheduler');
  }

  private async runCycle() {
    if (this.isRunning) {
      logger.warn('Cur-clan autofill still running; skipping overlapping cycle');
      return;
    }

    this.isRunning = true;
    try {
      const sheets = await getAuthenticatedSheetsClient();
      const guildsRes = await pool.query<{ guild_id: string; stats_spreadsheetid: string }>(`
        SELECT guild_id, stats_spreadsheetid
        FROM server_settings
        WHERE COALESCE(stats_spreadsheetid, '') <> ''
      `);

      for (const row of guildsRes.rows) {
        await this.fillLeagueLineupsSheet(sheets, row.guild_id, row.stats_spreadsheetid, '5k');
        await this.fillLeagueLineupsSheet(sheets, row.guild_id, row.stats_spreadsheetid, '4k');
      }
    } catch (error) {
      logger.error('Lineup autofill cycle failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async fillLeagueLineupsSheet(
    sheets: sheets_v4.Sheets,
    guildId: string,
    spreadsheetId: string,
    league: '5k' | '4k',
  ) {
    const sheetName = `${league} Lineups`;

    // Read the header row to detect which clan blocks are present.
    let headerRow: string[] = [];
    try {
      const headerRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:ZZ1`,
      });
      headerRow = (headerRes.data.values?.[0] as string[] | undefined) ?? [];
    } catch {
      return;
    }

    if (headerRow.length === 0) return;

    // Build tag → current clan map from DB snapshots (all linked clans in this guild).
    const clansRes = await pool.query<{
      abbreviation: string | null;
      clantag: string;
      last_activity_snapshot: unknown;
    }>(`SELECT abbreviation, clantag, last_activity_snapshot FROM clans WHERE guild_id = $1`, [guildId]);

    const snapshotTagToClan = new Map<string, string>();
    for (const row of clansRes.rows) {
      const clanLabel = (row.abbreviation ?? '').toUpperCase() || row.clantag;
      const snapshot =
        typeof row.last_activity_snapshot === 'string'
          ? (() => {
              try {
                return JSON.parse(row.last_activity_snapshot as string) as {
                  memberList?: Array<{ tag?: string }>;
                };
              } catch {
                return null;
              }
            })()
          : (row.last_activity_snapshot as { memberList?: Array<{ tag?: string }> } | null);

      for (const member of snapshot?.memberList ?? []) {
        const normalized = normalizeTag(String(member?.tag ?? '').trim());
        if (normalized) snapshotTagToClan.set(normalized, clanLabel);
      }
    }

    const updates: sheets_v4.Schema$ValueRange[] = [];
    const fameColIndexes: number[] = [];

    for (let startCol = 0; startCol < headerRow.length; startCol += LINEUP_BLOCK_WIDTH) {
      const clanName = (headerRow[startCol] ?? '').trim();
      if (!clanName) continue;

      // Tag column is startCol + 1 (e.g. col B for clan 0).
      const tagColLetter = colToLetter(startCol + 1);
      const firstDataRow = 3; // 1-based: row 3 is first player row
      const lastDataRow = 2 + LINEUP_DATA_ROWS;

      let tagColumn: string[] = [];
      try {
        const tagRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${sheetName}!${tagColLetter}${firstDataRow}:${tagColLetter}${lastDataRow}`,
        });
        tagColumn = ((tagRes.data.values ?? []) as string[][]).map((r) => r[0] ?? '');
      } catch {
        continue;
      }

      const curClanValues = tagColumn.map((rawTag) => {
        if (!rawTag || rawTag.trim() === '') return [''];
        const normalized = normalizeTag(rawTag.trim());
        return [snapshotTagToClan.get(normalized) ?? '—'];
      });

      // Pad to full LINEUP_DATA_ROWS in case the read returned fewer rows.
      while (curClanValues.length < LINEUP_DATA_ROWS) curClanValues.push(['']);

      const curClanColLetter = colToLetter(startCol + CUR_CLAN_COL_OFFSET);
      updates.push({
        range: `${sheetName}!${curClanColLetter}${firstDataRow}:${curClanColLetter}${lastDataRow}`,
        values: curClanValues,
      });

      // Track fame column index (startCol + 5 for each clan block) — only if it exists
      if (startCol + 5 < headerRow.length) {
        fameColIndexes.push(startCol + 5);
      }
    }

    if (updates.length === 0) return;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates,
      },
    });

    // Sort each clan block by fame column (descending), rows 3-54
    await this.sortByFame(sheets, spreadsheetId, sheetName, fameColIndexes);
  }

  private async sortByFame(
    sheets: sheets_v4.Sheets,
    spreadsheetId: string,
    sheetName: string,
    fameColIndexes: number[],
  ) {
    if (fameColIndexes.length === 0) return;

    const sheetId = await getSheetIdByName(spreadsheetId, sheetName);
    if (sheetId === null) {
      logger.warn(`[sortByFame] Sheet "${sheetName}" not found, skipping sort`);
      return;
    }

    const firstDataRow = 2; // 0-indexed row 3 is index 2
    const lastDataRow = 1 + LINEUP_DATA_ROWS; // 0-indexed row 54 is index 53

    // Sort each clan block sequentially to avoid API issues with batched sorts on adjacent ranges
    for (const fameColIndex of fameColIndexes) {
      const blockStartCol = Math.floor(fameColIndex / LINEUP_BLOCK_WIDTH) * LINEUP_BLOCK_WIDTH;
      const fameColOffset = fameColIndex % LINEUP_BLOCK_WIDTH;

      try {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                sortRange: {
                  range: {
                    sheetId,
                    startRowIndex: firstDataRow,
                    endRowIndex: lastDataRow,
                    startColumnIndex: blockStartCol,
                    endColumnIndex: blockStartCol + LINEUP_BLOCK_WIDTH,
                  },
                  sortSpecs: [{ dimensionIndex: fameColOffset, sortOrder: 'DESCENDING' }],
                },
              },
            ],
          },
        });
      } catch (error) {
        logger.error(`[sortByFame] Failed to sort ${sheetName} column ${fameColIndex}: ${error}`);
      }
    }
  }
}
