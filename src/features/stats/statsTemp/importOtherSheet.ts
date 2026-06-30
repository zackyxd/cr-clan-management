import { getAuthenticatedSheetsClient } from '../statsUtil.js';
const sourceSheets = await getAuthenticatedSheetsClient();
const sourceData = await sourceSheets.spreadsheets.values.get({
  spreadsheetId: '1b8BgwkPZ2cUgUvy_2r5zISCSxG207qtIf7re3sVL8x0',
  range: '5k Averages!A1:LP2000',
});
const rows = sourceData.data.values || [];
const headerRow = rows[0]; // ['Tag', 'Player', 'Last Clan', 'Fame / Atk.', '132-3', '', '132-2', '', ...]

// Grab only the season-week headers starting from column index 4
// They come in pairs: '132-3', '', '132-2', '', etc.
// So filter every other one (the non-empty ones)
const seasonWeekHeaders: string[] = [];
const headerValues = [['Discord Id', 'Tag', 'Player', 'Last Clan', 'Fame / Atk.']];
for (let i = 4; i < headerRow.length; i += 2) {
  const label = headerRow[i];
  if (label) seasonWeekHeaders.push(label); // ['132-3', '132-2', '132-1', '131-4', ...]
}

const mergeRequests = [];
for (let i = 0; i < seasonWeekHeaders.length; i++) {
  const startCol = 5 + i * 2; // F=5, H=7, J=9, etc.
  const endCol = startCol + 2;

  mergeRequests.push({
    mergeCells: {
      range: {
        sheetId: 0,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: startCol,
        endColumnIndex: endCol,
      },
      mergeType: 'MERGE_ALL',
    },
  });

  headerValues[0].push(seasonWeekHeaders[i], ''); // Two values per column pair
}

const sheets = await getAuthenticatedSheetsClient();
const targetSpreadsheetId = '1-cfoEP2snXbZuoc37jKjhKMAFkkBcr6REGKoXd5aVug';

// rows[0] is the header, rows[1+] is data
const dataRows = rows.slice(1).map((row) => {
  // Source columns: Tag(0), Player(1), Last Clan(2), Fame/Atk(3), then pairs from col 4
  const tag = '#' + (row[0] ?? '');
  const player = row[1] ?? '';
  const lastClan = row[2] ?? '';
  const fameAvg = row[3] ?? ''; // This is a formula result - comes as the computed value

  // Season-week data: each pair is fame(col 4+i*2), attacks(col 5+i*2)
  const weekData: string[] = [];
  for (let i = 0; i < seasonWeekHeaders.length; i++) {
    weekData.push(row[4 + i * 2] ?? '', row[5 + i * 2] ?? '');
  }

  return ['', tag, player, lastClan, fameAvg, ...weekData]; // Column A (Discord) left blank
});

await sheets.spreadsheets.values.update({
  spreadsheetId: targetSpreadsheetId,
  range: '5k Averages!A1',
  valueInputOption: 'USER_ENTERED',
  requestBody: {
    values: [headerValues[0], ...dataRows],
  },
});

await sheets.spreadsheets.batchUpdate({
  spreadsheetId: targetSpreadsheetId,
  requestBody: {
    requests: mergeRequests,
  },
});
