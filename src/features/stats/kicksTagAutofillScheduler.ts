import { sheets_v4 } from 'googleapis';
import { pool } from '../../db.js';
import logger from '../../logger.js';
import { getClan, isFetchError, normalizeTag } from '../../api/CR_API.js';
import { colToLetter, getAuthenticatedSheetsClient } from './statsUtil.js';

const KICKS_BLOCK_WIDTH = 5;
const KICKS_DATA_ROWS = 50;
const DEFAULT_INTERVAL_MINUTES = 5;

export class KicksTagAutofillScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  private getIntervalMs(): number {
    const parsed = Number(process.env.KICKS_TAG_AUTOFILL_INTERVAL_MINUTES ?? DEFAULT_INTERVAL_MINUTES);
    const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MINUTES;
    return minutes * 60 * 1000;
  }

  start() {
    if (this.intervalId) return;

    const intervalMs = this.getIntervalMs();
    logger.info(`Starting kicks tag autofill scheduler (every ${Math.round(intervalMs / 60000)} minutes)`);

    this.intervalId = setInterval(() => {
      void this.runCycle();
    }, intervalMs);

    // Run once on startup.
    void this.runCycle();
  }

  stop() {
    if (!this.intervalId) return;
    clearInterval(this.intervalId);
    this.intervalId = null;
    logger.info('Stopped kicks tag autofill scheduler');
  }

  private async runCycle() {
    if (this.isRunning) {
      logger.warn('Kicks tag autofill still running; skipping overlapping cycle');
      return;
    }

    this.isRunning = true;
    try {
      const sheets = await getAuthenticatedSheetsClient();
      const guildsRes = await pool.query<{ guild_id: string; stats_spreadsheetId: string }>(`
        SELECT guild_id, "stats_spreadsheetId"
        FROM server_settings
        WHERE COALESCE("stats_spreadsheetId", '') <> ''
      `);

      for (const row of guildsRes.rows) {
        await this.fillLeagueKicksSheet(sheets, row.guild_id, row.stats_spreadsheetId, '5k');
        await this.fillLeagueKicksSheet(sheets, row.guild_id, row.stats_spreadsheetId, '4k');
      }
    } catch (error) {
      logger.error('Kicks tag autofill cycle failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async fillLeagueKicksSheet(
    sheets: sheets_v4.Sheets,
    guildId: string,
    spreadsheetId: string,
    league: '5k' | '4k',
  ) {
    const sheetName = `${league} Kicks`;

    let headerRow: string[] = [];
    try {
      const headerRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A2:ZZ2`,
      });
      headerRow = (headerRes.data.values?.[0] as string[] | undefined) ?? [];
    } catch {
      // Sheet may not exist for this guild yet.
      return;
    }

    if (headerRow.length === 0) return;

    const clansRes = await pool.query<{ clantag: string; abbreviation: string }>(
      `SELECT clantag, LOWER(abbreviation) AS abbreviation FROM clans WHERE guild_id = $1`,
      [guildId],
    );
    const clanTagByAbbrev = new Map(clansRes.rows.map((r) => [r.abbreviation, r.clantag]));

    const updates: sheets_v4.Schema$ValueRange[] = [];

    for (let startCol = 0; startCol < headerRow.length; startCol += KICKS_BLOCK_WIDTH) {
      const abbrev = (headerRow[startCol] ?? '').trim();
      if (!abbrev || abbrev.toUpperCase() === 'L2W') continue;

      const clanTag = clanTagByAbbrev.get(abbrev.toLowerCase());
      if (!clanTag) continue;

      const clanData = await getClan(clanTag);
      if (isFetchError(clanData)) {
        logger.warn(`Skipping kicks autofill for ${league} ${abbrev} in guild ${guildId}: clan fetch failed`);
        continue;
      }

      const tags = clanData.memberList.map((m) => normalizeTag(m.tag)).slice(0, KICKS_DATA_ROWS);
      const paddedTags = [...tags, ...Array(KICKS_DATA_ROWS - tags.length).fill('')];

      const tagColLetter = colToLetter(startCol + 2);
      updates.push({
        range: `${sheetName}!${tagColLetter}4:${tagColLetter}${3 + KICKS_DATA_ROWS}`,
        values: paddedTags.map((tag) => [tag]),
      });
    }

    if (updates.length === 0) return;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: updates,
      },
    });

    // logger.info(
    //   `Kicks tag autofill complete for guild ${guildId} ${league}: updated ${updates.length} clan block(s) in ${sheetName}`,
    // );
  }
}
