import 'dotenv-flow/config';
import { getAuthenticatedSheetsClient } from './statsUtil.js';

// Function to format header row (call this after any data update)
async function formatHeaders(spreadsheetId: string, sheetId: number = 0) {
  const sheets = await getAuthenticatedSheetsClient();

  // Read current row 1 to detect which season-week columns exist
  const headerResult = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!F1:ZZ1', // From column F onwards
  });
  const headerRow: string[] = headerResult.data.values?.[0] ?? [];

  // Detect season-week pairs: F1 (index 0), H1 (index 2), J1 (index 4)...
  // A season-week column exists if the cell has text in it
  const seasonWeekCount = Math.ceil(headerRow.length / 2);

  // Build formatting requests
  const requests: object[] = [
    {
      // Format header row (A1:E1) - centered, bold, colored background
      repeatCell: {
        range: {
          sheetId: sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0, // Column A
          endColumnIndex: 5, // Up to (A-E), not including col F
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.471, green: 0.471, blue: 0.471 },
            textFormat: {
              foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
              fontSize: 11,
              bold: true,
            },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      // Format columns A-C data cells (A2 onwards) - left aligned
      repeatCell: {
        range: {
          sheetId: sheetId,
          startRowIndex: 1,
          endRowIndex: 1000,
          startColumnIndex: 0, // Column A
          endColumnIndex: 3, // Up to but not including column D
        },
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } },
        fields: 'userEnteredFormat(horizontalAlignment)',
      },
    },
    {
      // Format columns D-E data cells - center aligned
      repeatCell: {
        range: {
          sheetId: sheetId,
          startRowIndex: 1,
          endRowIndex: 1000,
          startColumnIndex: 3, // Column D
          endColumnIndex: 5, // Up to but not including column F
        },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(horizontalAlignment)',
      },
    },
    {
      // Format E column - number format
      repeatCell: {
        range: {
          sheetId: sheetId,
          startRowIndex: 1,
          endRowIndex: 1000,
          startColumnIndex: 4, // Column E
          endColumnIndex: 5,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'NUMBER', pattern: '#,##0.00' },
          },
        },
        fields: 'userEnteredFormat(numberFormat)',
      },
    },
    // Column widths for A-E (Discord - Fame Avg)
    {
      // Discord id
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 155 },
        fields: 'pixelSize',
      },
    },
    {
      // Tag
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
        properties: { pixelSize: 95 },
        fields: 'pixelSize',
      },
    },
    {
      // Player
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
        properties: { pixelSize: 135 },
        fields: 'pixelSize',
      },
    },
    {
      // Last Clan
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 },
        properties: { pixelSize: 85 },
        fields: 'pixelSize',
      },
    },
    {
      // Fame Avg.
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 },
        properties: { pixelSize: 120 },
        fields: 'pixelSize',
      },
    },
  ];

  // Dynamically add merge + formatting for each detected season-week pair
  for (let i = 0; i < seasonWeekCount; i++) {
    const label = headerRow[i * 2]; // F1, H1, J1...
    if (!label) continue; // Skip if no header text (empty column pair)

    const startCol = 5 + i * 2; // F=5, H=7, J=9...
    const endCol = startCol + 2;

    // Alternate background colors between column pairs
    const headerBg =
      i % 2 === 0
        ? { red: 0.98, green: 0.976, blue: 0.659 } // Light yellow (even: 0, 2, 4...)
        : { red: 0.659, green: 0.663, blue: 0.98 }; // Light blue (odd: 1, 3, 5...)

    const dataBg =
      i % 2 === 0
        ? { red: 0.973, green: 0.988, blue: 0.812 } // Lighter yellow (even)
        : { red: 0.765, green: 0.769, blue: 0.988 }; // Lighter blue (odd)

    // Merge the two header cells into one (e.g. F1:G1)
    requests.push({
      mergeCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: startCol, endColumnIndex: endCol },
        mergeType: 'MERGE_ALL',
      },
    });

    // Format the merged season-week header cell
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: startCol, endColumnIndex: endCol },
        cell: {
          userEnteredFormat: {
            backgroundColor: headerBg,
            textFormat: { foregroundColor: { red: 0, green: 0, blue: 0 }, fontSize: 11, bold: true },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    });

    // Format data cells below: fame column (left) and attacks column (right)
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 1700, startColumnIndex: startCol, endColumnIndex: endCol },
        cell: {
          userEnteredFormat: {
            backgroundColor: dataBg,
            horizontalAlignment: 'CENTER',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,numberFormat)',
      },
    });

    // Fame column width (F, H, J...)
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: startCol, endIndex: startCol + 1 },
        properties: { pixelSize: 75 },
        fields: 'pixelSize',
      },
    });

    // Attacks column width (G, I, K...)
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: startCol + 1, endIndex: startCol + 2 },
        properties: { pixelSize: 50 },
        fields: 'pixelSize',
      },
    });

    // Freeze Discord Id - Fame avg
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1, frozenColumnCount: 5 },
        },
        fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  console.log(`Header formatting applied! (${seasonWeekCount} season-week columns detected)`);
}

// Test function - writes data and then applies formatting
async function testWriteAndFormat() {
  try {
    const sheets = await getAuthenticatedSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

    if (!spreadsheetId) {
      throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID not set in environment variables');
    }

    // Step 1: Write headers and data
    let header = [
      ['Discord', 'Tag', 'Player', 'Last Clan', 'Fame Avg.'], // Header row
    ];

    const resource = { values: header };

    const result = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'RAW',
      resource,
    });
    console.log('%d cells updated.', result.data.updatedCells);

    // Step 2: Apply formatting to headers
    // Sheet ID is usually 0 for the first sheet. You can get it from the sheet URL or API
    await formatHeaders(spreadsheetId, 0);

    console.log('✅ Data written and headers formatted!');
  } catch (error) {
    console.log(error);
  }
}

// Export for use in other modules
export { getAuthenticatedSheetsClient, formatHeaders };

// Run test if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await testWriteAndFormat();
}
