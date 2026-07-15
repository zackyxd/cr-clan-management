import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { makeCustomId } from '../../utils/customId.js';
import { buildPreviewEmbeds, computeAverageRoleChanges } from '../../features/stats/averageRoles.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { normalizeTag, getPlayer, isFetchError, CR_API, type RiverRaceLogSuccess } from '../../api/CR_API.js';
import { pool } from '../../db.js';
import {
  getAuthenticatedSheetsClient,
  colToLetter,
  getSheetIdByName,
  getSpreadsheetId,
  buildProtectedRangeRequest,
  buildClearProtectedRangeRequests,
  getServiceAccountEmail,
  isColosseumWeekFromStandings,
} from '../../features/stats/statsUtil.js';
import { PROTECTED_RANGE_ADMIN_EMAILS } from '../../config/constants.js';
import { type ClanHeaderTheme, resolveClanHeaderThemes } from '../../features/stats/clanHeaderColors.js';
import { refreshAvailableSheet } from '../../features/stats/availableSheet.js';
import { buildL2WSheet } from '../../features/stats/l2wSheet.js';
import {
  buildUpsertL2WPlayer,
  buildRemoveL2WPlayerAllLeagues,
  type UpsertL2WPlayerData,
} from '../../sql_queries/playerL2W.js';
import { buildGetFamilyClans } from '../../sql_queries/clans.js';

// ─── Lineup Sheet Layout Config ───────────────────────────────────────────────

// Number of data columns per clan block
const LINEUP_COLS_PER_CLAN = 6;
// Total width per block including the 1-column gap separator
const LINEUP_BLOCK_WIDTH = 7; // LINEUP_COLS_PER_CLAN + 1
// Number of player rows per clan
const LINEUP_DATA_ROWS = 52;

// Column header labels — index matches relative position (0–5) within each block
const LINEUP_COL_HEADERS = ['#', 'Tag', 'Player', 'Keep ✓', 'Cur. Clan', 'Fame / Atk.'];

// Pixel widths for each column in the block (0–5 = data cols, 6 = gap separator)
const LINEUP_COL_WIDTHS = [
  25, // 0: #
  95, // 1: Tag
  135, // 2: Player
  60, // 3: ✓ (checkbox)
  95, // 4: Clan
  80, // 5: Fame / Atk
  20, // 6: gap separator
];

const LINEUP_TITLE_FONT_SIZE = 12;

// Column header row color
const LINEUP_HEADER_BG = { red: 0.85, green: 0.85, blue: 0.85 }; // light gray
const L2W_ACCENT_BG = { red: 0.78, green: 0.78, blue: 0.78 }; // darker gray for L2W accents
const L2W_ACCENT_TEXT = { red: 0.12, green: 0.12, blue: 0.12 };

function lightenColor(
  color: { red?: number; green?: number; blue?: number } | null | undefined,
  amount: number,
): { red: number; green: number; blue: number } {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const mix = (v: number) => clamp(v + (1 - v) * amount);
  const red = color?.red ?? 1;
  const green = color?.green ?? 1;
  const blue = color?.blue ?? 1;
  return { red: mix(red), green: mix(green), blue: mix(blue) };
}

// ─────────────────────────────────────────────────────────────────────────────

// ─── Kicks Sheet Layout Config ───────────────────────────────────────────────

// Number of data columns per block
const KICKS_COLS_PER_CLAN = 4;
// Total width per block including the 1-column gap separator
const KICKS_BLOCK_WIDTH = 5;
// Number of player rows per clan
const KICKS_DATA_ROWS = 50;

const KICKS_COL_HEADERS = ['#', 'Player Name', 'Tag', 'in roster?'];
// Pixel width for each column
const KICKS_COL_WIDTHS = [
  25, // #
  135, // Name
  100, // Tag
  90, // Roster
  20, // gap separator
];

const KICKS_TITLE_FONT_SIZE = 12;

type SheetBlockResult = {
  values: (string | boolean)[][];
  requests: object[];
};

type AveragesRow = {
  rowNumber: number;
  discordId: string;
  tag: string;
  name: string;
  clanAbbr: string;
  weekValues: (number | string)[];
};

type FamilyClanRow = {
  clantag: string;
  clan_name: string;
  abbreviation: string;
  header_bg_hex: string | null;
  header_text_hex: string | null;
};

type ClanThemeRow = {
  abbreviation: string;
  header_bg_hex: string | null;
  header_text_hex: string | null;
  l2w_clan?: boolean | null;
};

const AVERAGES_FIXED_HEADERS = ['Discord', 'Tag', 'Player', 'Last Clan', 'Fame / Atk.'];
const AVERAGES_WEEK_START_COL = 5;

function buildAveragesFameFormula(rowNumber: number, lastWeekColLetter: string): string {
  // Score = sum(latest 3 fame values) / sum(latest 3 attack values).
  // Week pairs are dynamic (F/G, H/I, ...), so we compute from F through current last week col.
  return (
    `=IFERROR(LET(` +
    `r,F${rowNumber}:${lastWeekColLetter}${rowNumber},` +
    `f,ARRAY_CONSTRAIN(FILTER(r,MOD(COLUMN(r)-COLUMN($F$1),2)=0,r<>""),1,3),` +
    `a,ARRAY_CONSTRAIN(FILTER(r,MOD(COLUMN(r)-COLUMN($F$1),2)=1,r<>""),1,3),` +
    `IF(COUNTA(r)=0,0,SUM(f)/MAX(1,SUM(a)))` +
    `),0)`
  );
}

async function ensureSheetGridCapacity(
  sheets: Awaited<ReturnType<typeof getAuthenticatedSheetsClient>>,
  spreadsheetId: string,
  sheetId: number,
  requiredRows: number,
  requiredColumns: number,
): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,gridProperties(rowCount,columnCount)))',
  });

  const targetSheet = meta.data.sheets?.find((sheet) => sheet.properties?.sheetId === sheetId);
  const currentRows = targetSheet?.properties?.gridProperties?.rowCount ?? 0;
  const currentColumns = targetSheet?.properties?.gridProperties?.columnCount ?? 0;

  const requests: object[] = [];
  if (requiredRows > currentRows) {
    requests.push({
      appendDimension: {
        sheetId,
        dimension: 'ROWS',
        length: requiredRows - currentRows,
      },
    });
  }

  if (requiredColumns > currentColumns) {
    requests.push({
      appendDimension: {
        sheetId,
        dimension: 'COLUMNS',
        length: requiredColumns - currentColumns,
      },
    });
  }

  if (requests.length === 0) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

// Formatting requests for averages tabs.
// Quick tweak guide:
// - header colors/fonts: first repeatCell block
// - alignment/number format: next repeatCell blocks
// - widths: updateDimensionProperties blocks
// - merged week headers + week col colors/widths: loop below
function buildAveragesFormattingRequests(
  sheetId: number,
  weekHeaders: string[],
  colosseumWeekHeaders: Set<string>,
): object[] {
  const requests: object[] = [
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: AVERAGES_WEEK_START_COL,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.8, green: 0.8, blue: 0.8 },
            textFormat: {
              foregroundColor: { red: 0, green: 0, blue: 0 },
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
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 0,
          endColumnIndex: 3,
        },
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } },
        fields: 'userEnteredFormat(horizontalAlignment)',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 3,
          endColumnIndex: AVERAGES_WEEK_START_COL,
        },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat(horizontalAlignment)',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 4,
          endColumnIndex: 5,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'NUMBER', pattern: '##0.00' },
          },
        },
        fields: 'userEnteredFormat(numberFormat)',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 155 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 2 },
        properties: { pixelSize: 95 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 2, endIndex: 3 },
        properties: { pixelSize: 135 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 3, endIndex: 4 },
        properties: { pixelSize: 85 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 4, endIndex: 5 },
        properties: { pixelSize: 120 },
        fields: 'pixelSize',
      },
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: { frozenRowCount: 1, frozenColumnCount: 5 },
        },
        fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
      },
    },
  ];

  if (weekHeaders.length > 0) {
    requests.unshift({
      unmergeCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: AVERAGES_WEEK_START_COL,
          endColumnIndex: AVERAGES_WEEK_START_COL + weekHeaders.length * 2,
        },
      },
    });
  }

  for (let i = 0; i < weekHeaders.length; i++) {
    const weekHeader = weekHeaders[i];
    const startCol = AVERAGES_WEEK_START_COL + i * 2;
    const endCol = startCol + 2;
    // const headerBg =
    //   i % 2 === 0
    //     ? { red: 0.98, green: 0.976, blue: 0.659 }
    //     : { red: 0.659, green: 0.663, blue: 0.98 };
    // const dataBg =
    //   i % 2 === 0
    //     ? { red: 0.973, green: 0.988, blue: 0.812 }
    //     : { red: 0.765, green: 0.769, blue: 0.988 };

    requests.push(
      {
        mergeCells: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: startCol,
            endColumnIndex: endCol,
          },
          mergeType: 'MERGE_ALL',
        },
      },
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: startCol,
            endColumnIndex: endCol,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.8, green: 0.8, blue: 0.8 },
              textFormat: {
                foregroundColor: { red: 0, green: 0, blue: 0 },
                fontSize: 11,
                bold: true,
                italic: colosseumWeekHeaders.has(weekHeader),
              },
              horizontalAlignment: 'CENTER',
              verticalAlignment: 'MIDDLE',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
        },
      },
      {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 1,
            endRowIndex: 2000,
            startColumnIndex: startCol,
            endColumnIndex: endCol,
          },
          cell: {
            userEnteredFormat: {
              // backgroundColor: dataBg,
              horizontalAlignment: 'CENTER',
              numberFormat: { type: 'NUMBER', pattern: '#,##0' },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,numberFormat)',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: startCol, endIndex: startCol + 1 },
          properties: { pixelSize: 75 },
          fields: 'pixelSize',
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId, dimension: 'COLUMNS', startIndex: startCol + 1, endIndex: startCol + 2 },
          properties: { pixelSize: 50 },
          fields: 'pixelSize',
        },
      },
    );
  }

  requests.push({
    addBanding: {
      bandedRange: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2000, startColumnIndex: 0 },
        rowProperties: {
          firstBandColor: { red: 1, green: 1, blue: 1 },
          secondBandColor: { red: 0.95, green: 0.95, blue: 0.95 },
        },
      },
    },
  });

  return requests;
}

// Backfills only missing Discord IDs (col A) for rows that already have linked tags (col B).
async function fillMissingDiscordIdsInSheet(
  sheets: Awaited<ReturnType<typeof getAuthenticatedSheetsClient>>,
  spreadsheetId: string,
  sheetName: string,
  linkedDiscordIds: Map<string, string>,
): Promise<number> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A2:B`,
  });

  const rows = response.data.values ?? [];
  const updates: { range: string; values: string[][] }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const currentDiscord = String(rows[i]?.[0] ?? '').trim();
    const tag = normalizeTag(String(rows[i]?.[1] ?? ''));
    if (!tag || currentDiscord) continue;

    const linkedDiscordId = linkedDiscordIds.get(tag);
    if (!linkedDiscordId) continue;
    updates.push({ range: `'${sheetName}'!A${rowNumber}`, values: [[linkedDiscordId]] });
  }

  if (updates.length === 0) return 0;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: updates,
    },
  });

  return updates.length;
}

function buildFameAtkGradientRule(sheetId: number): object {
  return {
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId, startRowIndex: 1, endRowIndex: 2000, startColumnIndex: 4, endColumnIndex: 5 }],
        gradientRule: {
          minpoint: { color: { red: 0.902, green: 0.486, blue: 0.451 }, type: 'MIN' },
          midpoint: { color: { red: 1, green: 0.839, blue: 0.4 }, type: 'PERCENTILE', value: '50' },
          maxpoint: { color: { red: 0.341, green: 0.733, blue: 0.541 }, type: 'MAX' },
        },
      },
      index: 0,
    },
  };
}

async function applyAveragesLastClanColorRules(
  sheets: Awaited<ReturnType<typeof getAuthenticatedSheetsClient>>,
  spreadsheetId: string,
  avgSheetIds: number[],
  clanRows: ClanThemeRow[],
): Promise<void> {
  if (avgSheetIds.length === 0) return;

  const resolvedOrder = Array.from(new Set(clanRows.map((row) => row.abbreviation.toUpperCase())));
  if (resolvedOrder.length === 0) return;

  const resolvedThemes = resolveClanHeaderThemes(resolvedOrder, clanRows);

  // Clear old color rules on Player (C), Last Clan (D), and Fame/Atk (E) columns for both 4k/5k averages, then add fresh ones.
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId),conditionalFormats)',
  });

  const allSheets = meta.data.sheets ?? [];
  const deleteRequests: object[] = [];
  for (const sheetId of avgSheetIds) {
    const sheet = allSheets.find((s) => s.properties?.sheetId === sheetId);
    const rules = sheet?.conditionalFormats ?? [];
    const toDelete = rules
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) =>
        rule.ranges?.some((range) => (range.startColumnIndex ?? 0) <= 4 && (range.endColumnIndex ?? 26) > 2),
      )
      .map(({ index }) => index)
      .reverse();

    for (const index of toDelete) {
      deleteRequests.push({ deleteConditionalFormatRule: { sheetId, index } });
    }
  }

  const addRequests: object[] = [];
  for (const sheetId of avgSheetIds) {
    addRequests.push(
      buildFameAtkGradientRule(sheetId),
      ...resolvedOrder.map((clan, idx) => {
        const row = clanRows.find((r) => r.abbreviation.toUpperCase() === clan);
        const isL2W = Boolean(row?.l2w_clan);
        return {
          addConditionalFormatRule: {
            rule: {
              ranges: [
                {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: 2000,
                  startColumnIndex: 2,
                  endColumnIndex: 3,
                },
              ],
              booleanRule: {
                condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=$D2="${clan}"` }] },
                format: {
                  backgroundColor: isL2W ? L2W_ACCENT_BG : resolvedThemes[idx].backgroundColor,
                  textFormat: {
                    foregroundColor: isL2W ? L2W_ACCENT_TEXT : resolvedThemes[idx].textColor,
                  },
                },
              },
            },
            index: 0,
          },
        };
      }),
    );
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [...deleteRequests, ...addRequests] },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export function averagesNameFormula(colLetter: string, row: number): string {
  const tagRef = `${colLetter}${row}`;

  return (
    `=IFERROR(` +
    `XLOOKUP(IF(LEFT(${tagRef},1)="#",${tagRef},"#"&${tagRef}),'5k Averages'!B:B,'5k Averages'!C:C),` +
    `IFERROR(` +
    `XLOOKUP(IF(LEFT(${tagRef},1)="#",${tagRef},"#"&${tagRef}),'4k Averages'!B:B,'4k Averages'!C:C),` +
    `"—"` +
    `)` +
    `)`
  );
}

export function averagesFameFormula(colLetter: string, row: number, league: '5k' | '4k'): string {
  const tagRef = `${colLetter}${row}`;
  const sheet = `'${league} Averages'`;

  return (
    `=XLOOKUP(` + `IF(LEFT(${tagRef},1)="#",${tagRef},"#"&${tagRef}),` + `${sheet}!B:B,` + `${sheet}!E:E,` + `""` + `)`
  );
}

/**
 * Builds the values grid and formatting requests for a single clan block.
 * clanIndex determines the horizontal offset (each block is LINEUP_BLOCK_WIDTH cols wide).
 */
function buildClanBlock(
  clanName: string,
  clanIndex: number,
  sheetId: number,
  theme: ClanHeaderTheme,
  isL2WClan: boolean,
  l2wSheetsExist = false,
  league: '5k' | '4k' = '5k',
): SheetBlockResult {
  const startCol = clanIndex * LINEUP_BLOCK_WIDTH;
  const blockHeaderBg = isL2WClan ? L2W_ACCENT_BG : lightenColor(theme.backgroundColor, 0.3);
  const blockHeaderText = isL2WClan ? L2W_ACCENT_TEXT : theme.textColor;

  // --- Values: (2 + LINEUP_DATA_ROWS) rows × LINEUP_BLOCK_WIDTH cols ---
  const values: (string | boolean)[][] = [];

  // Row 0: clan title (first cell holds name; rest empty — merge handles display)
  values.push([clanName, ...Array(LINEUP_BLOCK_WIDTH - 1).fill('')]);

  // Row 1: column headers + empty gap cell
  values.push([...LINEUP_COL_HEADERS, '']);

  // Rows 2–(1 + LINEUP_DATA_ROWS): numbered player rows
  for (let i = 1; i <= LINEUP_DATA_ROWS; i++) {
    const tagCol = colToLetter(startCol + 1); // e.g. clan 0 → B, clan 1 → I
    // const nameFormula = `=XLOOKUP(${tagCol}${i + 2}, '5k Averages'!B:B, '5k Averages'!C:C, "N/A")`; // looks up name by tag from averages sheet

    const nameFormula = averagesNameFormula(tagCol, i + 2);

    // Cur. Clan is filled by lineupsAutofillScheduler — written as plain values, not a formula.
    const fameAtkFormula = averagesFameFormula(tagCol, i + 2, league);
    values.push([String(i), '', nameFormula, '', '', fameAtkFormula, '']);
  }

  // Row (2 + LINEUP_DATA_ROWS): "Clan Avg" summary row
  // — col 4 (Cur. Clan) holds the label, col 5 (Fame / Atk.) is left blank for the value
  const clanAvgFormula = `=IFERROR(ROUND(AVERAGE(IFNA(${colToLetter(startCol + 5)}3:${colToLetter(startCol + 5)}${2 + LINEUP_DATA_ROWS}, "")), 2), "No Scores")`;
  values.push(['', 'Avg Wanted:', '', '', 'Clan Avg', clanAvgFormula, '']);

  // --- Requests ---
  const requests: object[] = [];

  // 1. Merge clan title across the 6 data columns (excludes gap)
  requests.push({
    mergeCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: startCol,
        endColumnIndex: startCol + LINEUP_COLS_PER_CLAN,
      },
      mergeType: 'MERGE_ALL',
    },
  });

  // 2. Format clan title row (colored bg, white bold centered text)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: 1,
        startColumnIndex: startCol,
        endColumnIndex: startCol + LINEUP_COLS_PER_CLAN,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: theme.backgroundColor,
          textFormat: { bold: true, foregroundColor: theme.textColor, fontSize: LINEUP_TITLE_FONT_SIZE },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    },
  });

  // 3. Format column headers row (lighter clan tint, bold, centered)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: startCol,
        endColumnIndex: startCol + LINEUP_COLS_PER_CLAN,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: blockHeaderBg,
          textFormat: { bold: true, foregroundColor: blockHeaderText },
          horizontalAlignment: 'CENTER',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
    },
  });

  // 4. Checkbox data validation for the ✓ column (relative col 3)
  requests.push({
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 2,
        endRowIndex: 2 + LINEUP_DATA_ROWS,
        startColumnIndex: startCol + 3,
        endColumnIndex: startCol + 4,
      },
      rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true },
    },
  });

  // 5. Center-align all data rows (rows 2 through 1 + LINEUP_DATA_ROWS)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 2,
        endRowIndex: 2 + LINEUP_DATA_ROWS,
        startColumnIndex: startCol,
        endColumnIndex: startCol + LINEUP_COLS_PER_CLAN,
      },
      cell: {
        userEnteredFormat: { horizontalAlignment: 'CENTER', numberFormat: { type: 'TEXT' } },
      },
      fields: 'userEnteredFormat(horizontalAlignment,numberFormat)',
    },
  });

  // 5b. "#" column: same lightened color as the block header
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 2,
        endRowIndex: 2 + LINEUP_DATA_ROWS,
        startColumnIndex: startCol,
        endColumnIndex: startCol + 1,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: blockHeaderBg,
          textFormat: { foregroundColor: blockHeaderText },
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat.foregroundColor)',
    },
  });

  // Fame / atk to be number formatted:
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 2,
        endRowIndex: 2 + LINEUP_DATA_ROWS,
        startColumnIndex: startCol + 5,
        endColumnIndex: startCol + 6,
      },
      cell: {
        userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '##0.00' } },
      },
      fields: 'userEnteredFormat(numberFormat)',
    },
  });

  // 6. Format the "Avg Wanted:" label in the summary row to be right-aligned and italic
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 2 + LINEUP_DATA_ROWS,
        endRowIndex: 3 + LINEUP_DATA_ROWS,
        startColumnIndex: startCol + 1,
        endColumnIndex: startCol + 2, // includes the label and the 4 empty cells before the avg value
      },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: 'RIGHT',
          textFormat: { italic: true },
        },
      },
      fields: 'userEnteredFormat(horizontalAlignment,textFormat)',
    },
  });

  // 7. Format "Clan Avg" row — gray bg + bold on cols 4 (Cur. Clan) and 5 (Fame / Atk.)
  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 2 + LINEUP_DATA_ROWS,
        endRowIndex: 3 + LINEUP_DATA_ROWS,
        startColumnIndex: startCol + 4,
        endColumnIndex: startCol + 6,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: LINEUP_HEADER_BG,
          textFormat: { bold: true, italic: true },
          horizontalAlignment: 'RIGHT',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
    },
  });

  // 8. Column widths — all 7 cols including the gap separator
  for (let col = 0; col < LINEUP_BLOCK_WIDTH; col++) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: startCol + col,
          endIndex: startCol + col + 1,
        },
        properties: { pixelSize: LINEUP_COL_WIDTHS[col] },
        fields: 'pixelSize',
      },
    });
  }

  // 9. Conditional format: Fame/Atk is -15 or more BELOW the avg wanted → light red
  //
  //  Formula breakdown (e.g. clan 0):
  //    fameCol   = F  — the Fame/Atk column being formatted (startCol + 5)
  //    F3        — the cell being evaluated; Sheets auto-adjusts per row (F4, F5...)
  //    C$56      — the fixed "Avg Wanted" reference cell (startCol+2, row 55 0-indexed = 56 1-indexed)
  //    ISNUMBER  — skip non-numeric cells like "N/A" text
  //    F3<=C$56-15  — fame value is 15 or more below the avg wanted
  const fameCol = colToLetter(startCol + 5); // e.g. F for clan 0
  const avgWantedCol = colToLetter(startCol + 2); // e.g. C for clan 0 (col 2 within block)
  const avgWantedRef = `${avgWantedCol}$${3 + LINEUP_DATA_ROWS}`; // e.g. C$56

  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: 2,
            endRowIndex: 2 + LINEUP_DATA_ROWS,
            startColumnIndex: startCol + 5,
            endColumnIndex: startCol + 6,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [
              {
                userEnteredValue: `=AND(ISNUMBER(${fameCol}3),ISNUMBER(${avgWantedRef}),${fameCol}3<=${avgWantedRef}-15)`,
              },
            ],
          },
          format: { backgroundColor: { red: 0.96, green: 0.8, blue: 0.8 } }, // light red
        },
      },
      index: 0,
    },
  });

  // 10. Conditional format: Fame/Atk is +25 or more ABOVE the avg wanted → light green
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: 2,
            endRowIndex: 2 + LINEUP_DATA_ROWS,
            startColumnIndex: startCol + 5,
            endColumnIndex: startCol + 6,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [
              {
                userEnteredValue: `=AND(ISNUMBER(${fameCol}3),ISNUMBER(${avgWantedRef}),${fameCol}3>=${avgWantedRef}+25)`,
              },
            ],
          },
          format: { backgroundColor: { red: 0.85, green: 0.93, blue: 0.83 } }, // light green
        },
      },
      index: 0,
    },
  });

  const tagCol = colToLetter(startCol + 1); // Tag column for this clan block
  const playerNameCol = colToLetter(startCol + 2); // Player Name column for this clan block
  // 12. Conditional format: Player Name is orange if the player is on the L2W | Inactive sheet.
  //   Only added when both L2W sheets already exist — the Sheets API rejects cross-sheet
  //   CUSTOM_FORMULA references to sheets that don't exist yet.
  if (l2wSheetsExist)
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId,
              startRowIndex: 2,
              endRowIndex: 2 + LINEUP_DATA_ROWS,
              startColumnIndex: startCol + 2,
              endColumnIndex: startCol + 3,
            },
          ],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [
                {
                  userEnteredValue: `=COUNTIF(INDIRECT("'5k L2W | Inactive'!A:A"),${tagCol}3)+COUNTIF(INDIRECT("'4k L2W | Inactive'!A:A"),${tagCol}3)>0`,
                },
              ],
            },
            format: { backgroundColor: { red: 1.0, green: 0.6, blue: 0.2 } }, // orange
          },
        },
        index: 0,
      },
    });

  // 11. Conditional format: flag duplicate tags in this block.

  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: 2,
            endRowIndex: 2 + LINEUP_DATA_ROWS,
            startColumnIndex: startCol + 2,
            endColumnIndex: startCol + 3,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [
              {
                userEnteredValue:
                  `=AND($${tagCol}3<>"",` +
                  `COUNTIF(ARRAYFORMULA(SUBSTITUTE($A$3:$ZZ$100,"#","")),` +
                  `SUBSTITUTE($${tagCol}3,"#",""))>1)`,
              },
            ],
          },
          format: { backgroundColor: { red: 0.96, green: 0.8, blue: 0.8 } },
        },
      },
      index: 0,
    },
  });

  // 13. Conditional format: Tag is highlighted if the player isn't linked to a
  //   Discord account on the Averages sheets (Discord column is blank/missing).
  requests.push({
    addConditionalFormatRule: {
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: 2,
            endRowIndex: 2 + LINEUP_DATA_ROWS,
            startColumnIndex: startCol + 1,
            endColumnIndex: startCol + 2,
          },
        ],
        booleanRule: {
          condition: {
            type: 'CUSTOM_FORMULA',
            values: [
              {
                userEnteredValue:
                  `=AND($${tagCol}3<>"",` +
                  `COUNTIFS(INDIRECT("'5k Averages'!B:B"),IF(LEFT($${tagCol}3,1)="#",$${tagCol}3,"#"&$${tagCol}3),INDIRECT("'5k Averages'!A:A"),"<>")=0,` +
                  `COUNTIFS(INDIRECT("'4k Averages'!B:B"),IF(LEFT($${tagCol}3,1)="#",$${tagCol}3,"#"&$${tagCol}3),INDIRECT("'4k Averages'!A:A"),"<>")=0)`,
              },
            ],
          },
          format: { backgroundColor: { red: 1.0, green: 0.95, blue: 0.6 } }, // light yellow
        },
      },
      index: 0,
    },
  });

  // Suppress unused variable warning — playerNameCol is intentionally unused (range covers it)
  void playerNameCol;
  void l2wSheetsExist;

  return { values, requests };
}

function buildKickBlock(
  clanName: string,
  clanIndex: number,
  sheetId: number,
  lineupsSheetName: string,
  blockCount: number,
  theme: ClanHeaderTheme,
  isL2W: boolean,
): SheetBlockResult {
  const startCol = clanIndex * KICKS_BLOCK_WIDTH;
  const blockHeaderBg = isL2W ? L2W_ACCENT_BG : lightenColor(theme.backgroundColor, 0.3);
  const blockHeaderText = isL2W ? L2W_ACCENT_TEXT : theme.textColor;

  const values2: (string | boolean)[][] = [];

  // Row 0 left blank so row 1 stays free for disclaimer text.
  values2.push(Array(KICKS_BLOCK_WIDTH).fill(''));

  values2.push([clanName, ...Array(KICKS_BLOCK_WIDTH - 1).fill('')]);

  // Row 1: column headers + empty gap cell
  values2.push([...KICKS_COL_HEADERS, '']);

  // Rows 2-(1 + KICKS_DATA_ROWS): numbered player rows
  for (let i = 1; i <= KICKS_DATA_ROWS; i++) {
    const sheetRow = i + 3; // row 4 is first data row (row 1 reserved for disclaimer)
    const tagCol = colToLetter(startCol + 2); // Player Tag column in Kicks block
    const nameFormula = averagesNameFormula(tagCol, sheetRow);

    const lineupTagCols: string[] = [];
    const lineupTitleCols: string[] = [];
    for (let block = 0; block < blockCount; block++) {
      lineupTagCols.push(colToLetter(block * LINEUP_BLOCK_WIDTH + 1));
      lineupTitleCols.push(colToLetter(block * LINEUP_BLOCK_WIDTH));
    }

    const headersArray = lineupTitleCols.map((col) => `'${lineupsSheetName}'!${col}$1`).join(',');
    const checksArray = lineupTagCols
      .map((col) => {
        const range = `'${lineupsSheetName}'!$${col}$3:$${col}$${2 + LINEUP_DATA_ROWS}`;
        return `SUMPRODUCT(--(UPPER(IF(LEFT(TRIM(${range}),1)="#",TRIM(${range}),"#"&TRIM(${range})))=target),--(TRIM(${range})<>""))>0`;
      })
      .join(',');

    const rosterFormula =
      `=LET(targetRaw,TRIM(${tagCol}${sheetRow}),` +
      `target,UPPER(IF(LEFT(targetRaw,1)="#",targetRaw,"#"&targetRaw)),` +
      `IF(targetRaw="","",IFERROR(INDEX({${headersArray}},1,MATCH(TRUE,{${checksArray}},0)),"")))`;

    values2.push([String(i), nameFormula, '', rosterFormula, '']);
  }

  const requests2: object[] = [];
  // 1. Merge clan title across the data columns (exclude gap)
  requests2.push({
    mergeCells: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: startCol,
        endColumnIndex: startCol + KICKS_COLS_PER_CLAN,
      },
      mergeType: 'MERGE_ALL',
    },
  });

  // 2. Format clan title row (colored bg, white bold centered text)
  requests2.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: startCol,
        endColumnIndex: startCol + KICKS_COLS_PER_CLAN,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: theme.backgroundColor,
          textFormat: { bold: true, foregroundColor: theme.textColor, fontSize: KICKS_TITLE_FONT_SIZE },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    },
  });

  // 3. Format column headers row
  requests2.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 2,
        endRowIndex: 3,
        startColumnIndex: startCol,
        endColumnIndex: startCol + KICKS_COLS_PER_CLAN,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: blockHeaderBg,
          textFormat: { bold: true, foregroundColor: blockHeaderText },
          horizontalAlignment: 'CENTER',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
    },
  });

  // 4. Center-align all data rows (rows 3 through 3 + LINEUP_DATA_ROWS)
  requests2.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 3,
        endRowIndex: 3 + KICKS_DATA_ROWS,
        startColumnIndex: startCol,
        endColumnIndex: startCol + KICKS_COLS_PER_CLAN,
      },
      cell: {
        userEnteredFormat: { horizontalAlignment: 'CENTER', numberFormat: { type: 'TEXT' } },
      },
      fields: 'userEnteredFormat(horizontalAlignment,numberFormat)',
    },
  });

  // 4b. "#" column: same lightened color as the block header
  requests2.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 3,
        endRowIndex: 3 + KICKS_DATA_ROWS,
        startColumnIndex: startCol,
        endColumnIndex: startCol + 1,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: blockHeaderBg,
          textFormat: { foregroundColor: blockHeaderText },
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat.foregroundColor)',
    },
  });

  // 4b. Conditional format for roster result.
  //   Real clan:  green = found in this clan's block; red = found in a different clan's block.
  //   L2W block:  green = found in any lineup block (player is rostered somewhere).
  //               No red rule — L2W players are expected to be spread across clans.
  const rosterCol = colToLetter(startCol + 3);
  const titleCol = colToLetter(startCol);
  const rosterRange = {
    sheetId,
    startRowIndex: 3,
    endRowIndex: 3 + KICKS_DATA_ROWS,
    startColumnIndex: startCol + 3,
    endColumnIndex: startCol + 4,
  };
  if (isL2W) {
    // Green: tag appears in any lineup block (formula returns a non-empty clan name)
    requests2.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [rosterRange],
          booleanRule: {
            condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=$${rosterCol}4<>""` }] },
            format: { backgroundColor: { red: 0.85, green: 0.93, blue: 0.83 } },
          },
        },
        index: 0,
      },
    });
  } else {
    // Green: found in this clan's own block
    requests2.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [rosterRange],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [{ userEnteredValue: `=AND($${rosterCol}4<>"",$${rosterCol}4=${titleCol}$2)` }],
            },
            format: { backgroundColor: { red: 0.85, green: 0.93, blue: 0.83 } },
          },
        },
        index: 0,
      },
    });
    // Red: found in a different clan's block
    requests2.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [rosterRange],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [{ userEnteredValue: `=AND($${rosterCol}4<>"",$${rosterCol}4<>${titleCol}$2)` }],
            },
            format: { backgroundColor: { red: 0.96, green: 0.8, blue: 0.8 } },
          },
        },
        index: 0,
      },
    });
  }

  // 5. Column widths — all 5 cols including the gap separator
  for (let col = 0; col < KICKS_BLOCK_WIDTH; col++) {
    requests2.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: startCol + col,
          endIndex: startCol + col + 1,
        },
        properties: { pixelSize: KICKS_COL_WIDTHS[col] },
        fields: 'pixelSize',
      },
    });
  }

  return { values: values2, requests: requests2 };
}

// ─── Sheet refresh helpers ───────────────────────────────────────────────────

/** Rebuild one L2W | Inactive sheet if it already exists. No-ops silently if the tab is missing. */
async function tryRefreshL2WSheet(guildId: string, spreadsheetId: string, league: '5k' | '4k') {
  const sheetName = `${league} L2W | Inactive`;
  const sheetId = await getSheetIdByName(spreadsheetId, sheetName);
  if (sheetId !== null) {
    await buildL2WSheet(guildId, spreadsheetId, sheetId, sheetName, league);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const MENTION_REGEX = /^<@!?(\d+)>$/;

/**
 * Resolves a raw "/stats …" player argument (either a Discord @mention or a
 * bare CR tag) to a { tag, name } pair.  Rejects with an error string if the
 * mention maps to 0 or 2+ accounts.
 */
async function resolvePlayerInput(
  guildId: string,
  input: string,
): Promise<{ tag: string; name: string } | { error: string }> {
  const mentionMatch = MENTION_REGEX.exec(input.trim());

  if (mentionMatch) {
    const discordId = mentionMatch[1];
    const res = await pool.query<{ playertag: string }>(
      `SELECT playertag FROM user_playertags WHERE guild_id = $1 AND discord_id = $2`,
      [guildId, discordId],
    );

    if (res.rows.length === 0) {
      return { error: `❌ That user has no linked CR accounts in this server.` };
    }
    if (res.rows.length > 1) {
      const tagList = res.rows.map((r) => `\`${r.playertag}\``).join(', ');
      return {
        error: `❌ That user has ${res.rows.length} linked accounts (${tagList}). Use the player tag directly instead.`,
      };
    }

    const tag = res.rows[0].playertag;
    const player = await getPlayer(tag);
    if (isFetchError(player)) {
      return { error: `❌ Could not fetch player info for \`${tag}\`.` };
    }
    return { tag, name: player.name };
  } else {
    const tag = normalizeTag(input.trim());
    if (!tag) {
      return { error: `❌ Invalid input \`${input}\`. Provide a player tag (\`#ABC123\`) or @mention.` };
    }
    const player = await getPlayer(tag);
    if (isFetchError(player)) {
      return { error: `❌ Could not find player \`${tag}\`. Check the tag and try again.` };
    }
    return { tag, name: player.name };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const runningGuilds = new Set<string>();

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Manage stats sheets')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('update-scores')
        .setDescription('Update scores on the averages page. Use this after Day 4 has completed.'),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('roles')
        .setDescription(
          'Preview and give roles for sheet averages (and colosseum scores). Run after /stats update-scores.',
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('lineup-order')
        .setDescription('Clan order for lineups. Must be linked.')
        .addStringOption((option) =>
          option
            .setName('league')
            .setDescription('League tier')
            .setRequired(true)
            .addChoices({ name: '5k', value: '5k' }, { name: '4k', value: '4k' }),
        )
        .addStringOption((option) =>
          option
            .setName('clan-order')
            .setDescription('Comma-separated clan order (e.g. "ClanA,ClanB,ClanC")')
            .setRequired(true),
        )
        .addBooleanOption((option) =>
          option
            .setName('preserve-data')
            .setDescription('Reapply formatting/rules without clearing existing lineup and kicks rows')
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('refresh')
        .setDescription('Process checkboxes and rebuild both the Available and L2W | Inactive sheets for a league')
        .addStringOption((o) =>
          o
            .setName('league')
            .setDescription('League tier')
            .setRequired(true)
            .addChoices({ name: '5k', value: '5k' }, { name: '4k', value: '4k' }),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('mark')
        .setDescription('Mark a player as L2W, Inactive, or Available')
        .addStringOption((o) =>
          o.setName('player').setDescription('Player tag (#ABC123) or @mention').setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('status')
            .setDescription('Status to assign')
            .setRequired(true)
            .addChoices(
              { name: 'Available', value: 'available' },
              { name: 'L2W', value: 'l2w' },
              { name: 'Inactive', value: 'inactive' },
            ),
        )
        .addStringOption((o) =>
          o
            .setName('league')
            .setDescription('League tier this player belongs to')
            .setRequired(true)
            .addChoices({ name: '5k', value: '5k' }, { name: '4k', value: '4k' }),
        )
        .addStringOption((o) => o.setName('notes').setDescription('Optional notes').setRequired(false))
        .addStringOption((o) =>
          o
            .setName('duration-days')
            // .setDescription('Expiry date (YYYY-MM-DD) or leave blank for indefinite')
            .setDescription('Number of days to L2W (leave blank for indefinite)')
            .setRequired(false),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (runningGuilds.has(guild.id)) {
      await interaction.reply({
        content: '⏳ A stats command is already running. Please wait for it to finish.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const isRolesSubcommand = subcommand === 'roles';
    // 'roles' reply is public so the rest of staff can see it ran (and click Apply).
    const allowed = await checkPerms(interaction, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: !isRolesSubcommand,
    });
    if (!allowed) return;

    runningGuilds.add(guild.id);
    try {
      if (subcommand === 'update-scores') {
        const sheets = await getAuthenticatedSheetsClient();
        const spreadsheetId = await getSpreadsheetId(guild.id);
        if (!spreadsheetId) {
          await interaction.editReply({
            content: '❌ Spreadsheet ID not configured. Please ask an admin to set it up.',
          });
          return;
        }

        // Build theme map for ALL clan abbreviations in DB so conditional rules can
        // color Cur. Clan/Last Clan even when abbreviation is not part of lineup-order input.
        const allClanThemeRows = (
          await pool.query<ClanThemeRow>(
            `SELECT LOWER(abbreviation) AS abbreviation, header_bg_hex, header_text_hex, family_clan, l2w_clan
           FROM clans
           WHERE guild_id = $1
             AND abbreviation IS NOT NULL AND (l2w_clan = TRUE OR family_clan = TRUE)`,
            [guild.id],
          )
        ).rows;

        // Check whether both L2W sheets exist so we can include the orange L2W warning rule
        const [averages4kId, averages5kId] = await Promise.all([
          getSheetIdByName(spreadsheetId, '4k Averages'),
          getSheetIdByName(spreadsheetId, '5k Averages'),
        ]);
        if (averages4kId === null || averages5kId === null) {
          await interaction.editReply({
            content: `❌ Sheet with name "4k Averages" not found in the spreadsheet.`,
          });
          return;
        }
        if (averages5kId === null) {
          await interaction.editReply({
            content: `❌ Sheet with name "5k Averages" not found in the spreadsheet.`,
          });
          return;
        }

        const query = buildGetFamilyClans(guild.id);
        const clansResult = await pool.query<FamilyClanRow>(query);
        const familyClans = clansResult.rows;

        const noDataClans: string[] = [];
        const clanLogs: {
          clantag: string;
          abbreviation: string;
          items: RiverRaceLogSuccess['items'];
        }[] = [];

        for (const familyClan of familyClans) {
          const rrLogAPI = await CR_API.getRiverRaceLog(familyClan.clantag);
          if (isFetchError(rrLogAPI)) {
            noDataClans.push(familyClan.abbreviation || familyClan.clan_name || familyClan.clantag);
            continue;
          }
          clanLogs.push({
            clantag: familyClan.clantag,
            abbreviation: familyClan.abbreviation.toUpperCase(),
            items: rrLogAPI.items,
          });
        }

        const linkedTagsRes = await pool.query<{ playertag: string; discord_id: string }>(
          `SELECT playertag, discord_id FROM user_playertags WHERE guild_id = $1`,
          [guild.id],
        );

        const linkedDiscordIds = new Map(
          linkedTagsRes.rows.map((row) => [normalizeTag(row.playertag), row.discord_id] as const),
        );

        const syncAveragesSheet = async (
          sheetName: '5k Averages' | '4k Averages',
          sheetId: number,
          league: '5k' | '4k',
        ) => {
          // 1) Read existing header + existing player rows. We only mutate needed cells.
          const headerResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!F1:1`,
          });
          const currentHeaderRow = headerResponse.data.values?.[0] ?? [];
          const existingWeeks: string[] = [];
          for (let i = 0; i < currentHeaderRow.length; i += 2) {
            const label = currentHeaderRow[i];
            if (label) existingWeeks.push(String(label));
          }

          const existingRowsResponse = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `'${sheetName}'!A2:ZZ`,
          });
          const existingRows = existingRowsResponse.data.values ?? [];

          const rowsByTag = new Map<string, AveragesRow>();
          const rowOrder: string[] = [];
          const existingWeekColCount = existingWeeks.length * 2;
          for (let i = 0; i < existingRows.length; i++) {
            const row = existingRows[i];
            const rawTag = row[1];
            if (!rawTag) continue;
            const tag = normalizeTag(String(rawTag));
            rowOrder.push(tag);
            rowsByTag.set(tag, {
              rowNumber: i + 2,
              discordId: String(row[0] ?? ''),
              tag,
              name: String(row[2] ?? ''),
              clanAbbr: String(row[3] ?? ''),
              weekValues: Array.from(
                { length: existingWeekColCount },
                (_, index) => row[AVERAGES_WEEK_START_COL + index] ?? '',
              ),
            });
          }

          // 2) Build week+player deltas from clan logs. Only weeks not already in sheet.
          const newWeeks: string[] = [];
          const colosseumWeekHeaders = new Set<string>();
          const aggregatedLogs = new Map<
            string,
            { tag: string; name: string; fame: number; attacks: number; season: string; clanAbbr: string }
          >();

          for (const clanLog of clanLogs) {
            let reachedExistingWeekForClan = false;
            for (const period of clanLog.items) {
              const seasonKey = `${period.seasonId}-${period.sectionIndex + 1}`;

              if (isColosseumWeekFromStandings(period.standings)) {
                colosseumWeekHeaders.add(seasonKey);
              }

              if (existingWeeks.includes(seasonKey)) {
                reachedExistingWeekForClan = true;
              }
              if (reachedExistingWeekForClan) continue;

              const foundStanding = period.standings.find((standing) => standing.clan.tag === clanLog.clantag);
              if (!foundStanding) continue;

              const currentClan = foundStanding.clan;
              if (league === '4k') {
                if (currentClan.clanScore < 4000 || currentClan.clanScore >= 5000) continue;
              } else if (currentClan.clanScore < 5000) {
                continue;
              }

              if (!newWeeks.includes(seasonKey)) newWeeks.push(seasonKey);

              for (const participant of currentClan.participants) {
                if (participant.fame <= 0 || participant.decksUsed <= 0) continue;
                const tag = normalizeTag(participant.tag);
                const key = `${seasonKey}|${tag}`;
                const previous = aggregatedLogs.get(key);
                aggregatedLogs.set(key, {
                  tag,
                  name: participant.name,
                  fame: (previous?.fame ?? 0) + participant.fame,
                  attacks: (previous?.attacks ?? 0) + Math.min(participant.decksUsed, 16),
                  season: seasonKey,
                  clanAbbr: clanLog.abbreviation,
                });
              }
            }
          }

          const newWeekColCount = newWeeks.length * 2;
          const allWeekHeaders = [...newWeeks, ...existingWeeks];
          const totalWeekColCount = allWeekHeaders.length * 2;
          const lastWeekColLetter =
            totalWeekColCount > 0 ? colToLetter(AVERAGES_WEEK_START_COL + totalWeekColCount - 1) : 'E';
          const firstNewWeekColLetter = colToLetter(AVERAGES_WEEK_START_COL);
          const lastNewWeekColLetter =
            newWeekColCount > 0 ? colToLetter(AVERAGES_WEEK_START_COL + newWeekColCount - 1) : firstNewWeekColLetter;

          // 3) Insert only new week columns at F+, then update header row + formatting.
          // Existing week data shifts right automatically; we do not rewrite whole sheet.
          if (newWeekColCount > 0) {
            await sheets.spreadsheets.batchUpdate({
              spreadsheetId,
              requestBody: {
                requests: [
                  {
                    insertDimension: {
                      range: {
                        sheetId,
                        dimension: 'COLUMNS',
                        startIndex: AVERAGES_WEEK_START_COL,
                        endIndex: AVERAGES_WEEK_START_COL + newWeekColCount,
                      },
                    },
                  },
                ],
              },
            });

            await sheets.spreadsheets.values.update({
              spreadsheetId,
              range: `'${sheetName}'!A1:${lastWeekColLetter}1`,
              valueInputOption: 'USER_ENTERED',
              requestBody: {
                values: [[...AVERAGES_FIXED_HEADERS, ...allWeekHeaders.flatMap((week) => [week, ''])]],
              },
            });

            const bandingMeta = await sheets.spreadsheets.get({
              spreadsheetId,
              fields: 'sheets(properties(sheetId),bandedRanges(bandedRangeId))',
            });
            const bandingSheet = bandingMeta.data.sheets?.find((s) => s.properties?.sheetId === sheetId);
            const deleteBandingRequests: object[] = (bandingSheet?.bandedRanges ?? [])
              .filter((b) => b.bandedRangeId !== undefined)
              .map((b) => ({ deleteBanding: { bandedRangeId: b.bandedRangeId } }));

            await sheets.spreadsheets.batchUpdate({
              spreadsheetId,
              requestBody: {
                requests: [
                  ...deleteBandingRequests,
                  ...buildAveragesFormattingRequests(sheetId, allWeekHeaders, colosseumWeekHeaders),
                ],
              },
            });
          }

          for (const row of rowsByTag.values()) {
            row.weekValues = [...Array(newWeekColCount).fill(''), ...row.weekValues];
          }

          for (const log of aggregatedLogs.values()) {
            let row = rowsByTag.get(log.tag);
            if (!row) {
              row = {
                rowNumber: 0,
                discordId: '',
                tag: log.tag,
                name: log.name,
                clanAbbr: log.clanAbbr,
                weekValues: Array(totalWeekColCount).fill(''),
              };
              rowsByTag.set(log.tag, row);
            }

            const weekIndex = newWeeks.indexOf(log.season);
            if (weekIndex === -1) continue;

            const fameIndex = weekIndex * 2;
            const attacksIndex = fameIndex + 1;
            row.name = log.name;
            row.clanAbbr = log.clanAbbr;
            row.weekValues[fameIndex] = Number(row.weekValues[fameIndex] || 0) + log.fame;
            row.weekValues[attacksIndex] = Number(row.weekValues[attacksIndex] || 0) + log.attacks;
          }

          // 4) Update existing rows in place (A:E metadata + new week cells only).
          const metadataUpdates: { range: string; values: (string | number)[][] }[] = [];
          const weekUpdates: { range: string; values: (string | number)[][] }[] = [];

          for (const tag of rowOrder) {
            const row = rowsByTag.get(tag);
            if (!row) continue;

            row.discordId = linkedDiscordIds.get(row.tag) ?? '';

            metadataUpdates.push({
              range: `'${sheetName}'!A${row.rowNumber}:E${row.rowNumber}`,
              values: [
                [
                  row.discordId,
                  row.tag,
                  row.name,
                  row.clanAbbr,
                  totalWeekColCount > 0 ? buildAveragesFameFormula(row.rowNumber, lastWeekColLetter) : '',
                ],
              ],
            });

            if (newWeekColCount > 0) {
              weekUpdates.push({
                range: `'${sheetName}'!${firstNewWeekColLetter}${row.rowNumber}:${lastNewWeekColLetter}${row.rowNumber}`,
                values: [row.weekValues.slice(0, newWeekColCount)],
              });
            }
          }

          // 5) Add only new tags as appended rows; old week cells stay blank for them.
          let newPlayerCount = 0;
          const appendRows: (string | number)[][] = [];
          for (const [tag, row] of rowsByTag) {
            if (rowOrder.includes(tag)) continue;
            newPlayerCount++;
            const rowNumber = existingRows.length + newPlayerCount + 1;
            const linkedDiscord = linkedDiscordIds.get(row.tag) ?? row.discordId;
            const oldWeekBlanks = Array(existingWeekColCount).fill('');
            appendRows.push([
              linkedDiscord,
              row.tag,
              row.name,
              row.clanAbbr,
              totalWeekColCount > 0 ? buildAveragesFameFormula(rowNumber, lastWeekColLetter) : '',
              ...row.weekValues.slice(0, newWeekColCount),
              ...oldWeekBlanks,
            ]);
          }

          // Ensure sheet has enough grid before any writes.
          // Prevents "range exceeds grid limits" when adding new players/weeks.
          const requiredRows = existingRows.length + appendRows.length + 1;
          const requiredColumns = AVERAGES_WEEK_START_COL + totalWeekColCount;
          await ensureSheetGridCapacity(sheets, spreadsheetId, sheetId, requiredRows, requiredColumns);

          if (metadataUpdates.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
              spreadsheetId,
              requestBody: { valueInputOption: 'USER_ENTERED', data: metadataUpdates },
            });
          }

          if (weekUpdates.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
              spreadsheetId,
              requestBody: { valueInputOption: 'USER_ENTERED', data: weekUpdates },
            });
          }

          if (appendRows.length > 0) {
            await sheets.spreadsheets.values.update({
              spreadsheetId,
              range: `'${sheetName}'!A${existingRows.length + 2}:${lastWeekColLetter}${existingRows.length + 1 + appendRows.length}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: appendRows },
            });
          }

          // Sort by latest week fame (column F) high -> low after updates/appends.
          const totalRows = existingRows.length + appendRows.length;
          if (totalRows > 0) {
            await sheets.spreadsheets.batchUpdate({
              spreadsheetId,
              requestBody: {
                requests: [
                  {
                    sortRange: {
                      range: {
                        sheetId,
                        startRowIndex: 1,
                        endRowIndex: totalRows + 1,
                        startColumnIndex: 0,
                        endColumnIndex: AVERAGES_WEEK_START_COL + totalWeekColCount,
                      },
                      sortSpecs: [{ dimensionIndex: 5, sortOrder: 'DESCENDING' }],
                    },
                  },
                ],
              },
            });
          }

          // 6) Optional pass: fill any blank Discord IDs on existing rows after sync.
          const discordBackfilled = await fillMissingDiscordIdsInSheet(
            sheets,
            spreadsheetId,
            sheetName,
            linkedDiscordIds,
          );

          return {
            weeksAdded: newWeeks.length,
            playersSynced: rowOrder.length + appendRows.length,
            playersAdded: appendRows.length,
            discordBackfilled,
          };
        };

        await Promise.all([
          syncAveragesSheet('5k Averages', averages5kId, '5k'),
          syncAveragesSheet('4k Averages', averages4kId, '4k'),
        ]);

        await applyAveragesLastClanColorRules(sheets, spreadsheetId, [averages5kId, averages4kId], allClanThemeRows);

        // const skippedSuffix = noDataClans.length > 0 ? ` Skipped no-data clans: ${noDataClans.join(', ')}.` : '';

        await interaction.editReply({
          content: `✅ Updated both average sheets.`,
        });
      }

      if (subcommand === 'lineup-order') {
        const league = interaction.options.getString('league', true) as '5k' | '4k';
        const clanOrderInput = interaction.options.getString('clan-order', true);
        const preserveData = interaction.options.getBoolean('preserve-data') ?? false;
        const clanOrder = clanOrderInput.split(',').map((clan) => clan.trim());

        // Filter out l2w
        const clansToLookup = clanOrder.filter((clan) => clan.toLowerCase() !== 'l2w');

        const normalizedInputs = clansToLookup.map((clan) => ({ original: clan, normalized: normalizeTag(clan) }));

        const tags = normalizedInputs.map((c) => c.normalized);
        const abbrevs = normalizedInputs.map((c) => c.original.toLowerCase());

        const clanRes = await pool.query<{
          clantag: string;
          abbreviation: string;
          header_bg_hex: string | null;
          header_text_hex: string | null;
          l2w_clan: boolean;
        }>(
          `
        SELECT clantag, LOWER(abbreviation) AS abbreviation, header_bg_hex, header_text_hex, family_clan, l2w_clan
          FROM clans
        WHERE guild_id = $1
          AND (clantag = ANY($2) OR LOWER(abbreviation) = ANY($3)) AND family_clan = TRUE
        `,
          [guild.id, tags, abbrevs],
        );

        // Find which inputs had no match
        const foundTags = new Set(clanRes.rows.map((r) => r.clantag));
        const foundAbbrevs = new Set(clanRes.rows.map((r) => r.abbreviation));

        const notFound = clansToLookup.filter(
          (clan) => !foundTags.has(normalizeTag(clan)) && !foundAbbrevs.has(clan.toLowerCase()),
        );

        if (notFound.length > 0) {
          await interaction.editReply({
            content: `❌ The following clans are not linked in this server: **${notFound.join(', ')}**.\nLink them to make the lineups order.`,
          });
          return;
        }

        const sheets = await getAuthenticatedSheetsClient();
        const spreadsheetId = await getSpreadsheetId(guild.id);
        if (!spreadsheetId) {
          await interaction.editReply({
            content: '❌ Spreadsheet ID not configured. Please ask an admin to set it up.',
          });
          return;
        }

        const allClanThemeRows = (
          await pool.query<ClanThemeRow>(
            `SELECT LOWER(abbreviation) AS abbreviation, header_bg_hex, header_text_hex, family_clan, l2w_clan
           FROM clans
           WHERE guild_id = $1
             AND abbreviation IS NOT NULL AND family_clan = TRUE`,
            [guild.id],
          )
        ).rows;
        const allClanOrder = Array.from(new Set(allClanThemeRows.map((row) => row.abbreviation.toUpperCase())));
        const allClanThemes = resolveClanHeaderThemes(allClanOrder, allClanThemeRows);
        const allClanThemeMap = new Map(
          allClanOrder.map(
            (abbr, idx) =>
              [
                abbr,
                {
                  theme: allClanThemes[idx],
                  isL2W: Boolean(allClanThemeRows.find((r) => r.abbreviation.toUpperCase() === abbr)?.l2w_clan),
                },
              ] as const,
          ),
        );

        // Map each clan in order to display name + l2w flag from DB.
        const resolvedOrder = clanOrder.map((input) => {
          const match = clanRes.rows.find(
            (r) => r.clantag === normalizeTag(input) || r.abbreviation === input.toLowerCase(),
          );
          return (match?.abbreviation ?? input).toUpperCase();
        });
        const resolvedIsL2W = clanOrder.map((input) => {
          const match = clanRes.rows.find(
            (r) => r.clantag === normalizeTag(input) || r.abbreviation === input.toLowerCase(),
          );
          return Boolean(match?.l2w_clan);
        });
        const resolvedThemes = resolveClanHeaderThemes(resolvedOrder, clanRes.rows);

        const lineupsSheetName = `${league} Lineups`;
        const kicksSheetName = `${league} Kicks`;

        // Check whether both L2W sheets exist so we can include the orange L2W warning rule
        const [lineupsSheetId, kicksSheetId, l2w5kId, l2w4kId] = await Promise.all([
          getSheetIdByName(spreadsheetId, lineupsSheetName),
          getSheetIdByName(spreadsheetId, kicksSheetName),
          getSheetIdByName(spreadsheetId, '5k L2W | Inactive'),
          getSheetIdByName(spreadsheetId, '4k L2W | Inactive'),
        ]);
        if (lineupsSheetId === null) {
          await interaction.editReply({
            content: `❌ Sheet with name "${lineupsSheetName}" not found in the spreadsheet.`,
          });
          return;
        }
        if (kicksSheetId === null) {
          await interaction.editReply({
            content: `❌ Sheet with name "${kicksSheetName}" not found in the spreadsheet.`,
          });
          return;
        }

        const l2wSheetsExist = l2w5kId !== null && l2w4kId !== null;

        function buildMergedSheet(
          rowCount: number,
          builder: (
            clanName: string,
            clanIndex: number,
            sheetId: number,
            theme: ClanHeaderTheme,
            isL2WClan: boolean,
            l2wExists: boolean,
          ) => SheetBlockResult,
          sheetId: number,
          l2wExists: boolean,
        ) {
          const mergedValues: (string | boolean)[][] = Array(rowCount)
            .fill(null)
            .map(() => []);
          const allRequests: object[] = [];

          for (let i = 0; i < resolvedOrder.length; i++) {
            const { values, requests } = builder(
              resolvedOrder[i],
              i,
              sheetId,
              resolvedThemes[i],
              resolvedIsL2W[i],
              l2wExists,
            );
            for (let row = 0; row < values.length; row++) {
              mergedValues[row].push(...values[row]);
            }
            allRequests.push(...requests);
          }

          return { mergedValues, allRequests };
        }

        const lineupsGrid = buildMergedSheet(
          3 + LINEUP_DATA_ROWS,
          (clanName, clanIndex, sheetId, theme, isL2WClan, l2wExists) =>
            buildClanBlock(clanName, clanIndex, sheetId, theme, isL2WClan, l2wExists, league),
          lineupsSheetId,
          l2wSheetsExist,
        );
        const kicksMergedValues: (string | boolean)[][] = Array(3 + KICKS_DATA_ROWS)
          .fill(null)
          .map(() => []);
        const kicksRequests: object[] = [];
        for (let i = 0; i < resolvedOrder.length; i++) {
          const { values, requests } = buildKickBlock(
            resolvedOrder[i],
            i,
            kicksSheetId,
            lineupsSheetName,
            resolvedOrder.length,
            resolvedThemes[i],
            resolvedIsL2W[i],
          );
          for (let row = 0; row < values.length; row++) {
            kicksMergedValues[row].push(...values[row]);
          }
          kicksRequests.push(...requests);
        }

        // Locked protections, applied per clan block:
        const KICKS_PROTECTION_NOTE = 'Auto-generated by /stats lineup-order — this sheet is fully automatic.';
        const protectedRangeEditors = [await getServiceAccountEmail(), ...PROTECTED_RANGE_ADMIN_EMAILS];
        for (let i = 0; i < resolvedOrder.length; i++) {

          // Kicks: every cell is bot-managed (numbering, Player/Tag autofill, roster formula).
          const kicksStartCol = i * KICKS_BLOCK_WIDTH;
          kicksRequests.push(
            buildProtectedRangeRequest(
              kicksSheetId,
              {
                startRowIndex: 0,
                endRowIndex: 3 + KICKS_DATA_ROWS,
                startColumnIndex: kicksStartCol,
                endColumnIndex: kicksStartCol + KICKS_BLOCK_WIDTH,
              },
              KICKS_PROTECTION_NOTE,
              protectedRangeEditors,
            ),
          );
        }

        // Cur. Clan column color rules on Lineups:
        // use ALL clan abbreviations from DB (not only lineup-order blocks),
        // so any current clan label can be colored correctly.
        const curClanColorRules: object[] = [];
        for (let block = 0; block < resolvedOrder.length; block++) {
          const startCol = block * LINEUP_BLOCK_WIDTH;
          const curClanCol = startCol + 4; // Cur. Clan column within each lineup block

          // Use resolvedIsL2W to check if clan is L2W, not allClanThemeMap
          for (let clanIdx = 0; clanIdx < resolvedOrder.length; clanIdx++) {
            const clan = resolvedOrder[clanIdx];
            const isL2W = resolvedIsL2W[clanIdx];
            const bg = isL2W ? L2W_ACCENT_BG : resolvedThemes[clanIdx].backgroundColor;
            const fg = isL2W ? L2W_ACCENT_TEXT : resolvedThemes[clanIdx].textColor;

            curClanColorRules.push({
              addConditionalFormatRule: {
                rule: {
                  ranges: [
                    {
                      sheetId: lineupsSheetId,
                      startRowIndex: 2,
                      endRowIndex: 2 + LINEUP_DATA_ROWS,
                      startColumnIndex: curClanCol,
                      endColumnIndex: curClanCol + 1,
                    },
                  ],
                  booleanRule: {
                    condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: clan }] },
                    format: {
                      backgroundColor: bg,
                      textFormat: { foregroundColor: fg },
                    },
                  },
                },
                index: 0,
              },
            });
          }
        }
        lineupsGrid.allRequests.push(...curClanColorRules);

        // Clear existing conditional format rules in reverse index order so reruns
        // do not accumulate stale rules across repeated lineup-order executions.
        const spreadsheetMeta = await sheets.spreadsheets.get({
          spreadsheetId,
          fields: 'sheets(properties(sheetId,title),conditionalFormats,protectedRanges.protectedRangeId)',
        });

        const allSheets = spreadsheetMeta.data.sheets ?? [];
        const getSheetIdFromMeta = (name: string): number | null => {
          const sheet = allSheets.find((s) => s.properties?.title === name);
          return sheet?.properties?.sheetId ?? null;
        };
        const getRuleCount = (targetSheetId: number): number => {
          const sheet = allSheets.find((s) => s.properties?.sheetId === targetSheetId);
          return sheet?.conditionalFormats?.length ?? 0;
        };
        const getProtectedRangeIds = (targetSheetId: number): number[] => {
          const sheet = allSheets.find((s) => s.properties?.sheetId === targetSheetId);
          return (sheet?.protectedRanges ?? [])
            .map((p) => p.protectedRangeId)
            .filter((id): id is number => id !== undefined);
        };

        // Clear all conditional format rules on lineups/kicks — they are fully rebuilt each run.
        const clearConditionalFormatRequests: object[] = [lineupsSheetId, kicksSheetId].flatMap((targetSheetId) => {
          const ruleCount = getRuleCount(targetSheetId);
          return Array.from({ length: ruleCount }, (_, i) => ({
            deleteConditionalFormatRule: {
              sheetId: targetSheetId,
              index: ruleCount - 1 - i,
            },
          }));
        });

        // Clear existing warn-on-edit protections on lineups/kicks — they are re-added below for every block.
        const clearProtectedRangeRequests: object[] = [lineupsSheetId, kicksSheetId].flatMap((targetSheetId) =>
          buildClearProtectedRangeRequests(getProtectedRangeIds(targetSheetId)),
        );

        // Clear Player (col C), Last Clan (col D), and Fame/Atk (col E) color rules on the averages sheet so
        // reruns don't accumulate stale rules there.
        const avgSheetId = getSheetIdFromMeta(`${league} Averages`);
        const clearAvgColorRules: object[] =
          avgSheetId !== null
            ? (() => {
                const avgSheet = allSheets.find((s) => s.properties?.sheetId === avgSheetId);
                const rules = avgSheet?.conditionalFormats ?? [];
                const toDelete = rules
                  .map((r, i) => ({ r, i }))
                  .filter(({ r }) =>
                    r.ranges?.some((range) => (range.startColumnIndex ?? 0) <= 4 && (range.endColumnIndex ?? 26) > 2),
                  )
                  .map(({ i }) => i)
                  .reverse();
                return toDelete.map((idx) => ({
                  deleteConditionalFormatRule: { sheetId: avgSheetId, index: idx },
                }));
              })()
            : [];

        // Clear existing merged ranges first; otherwise re-runs can fail when
        // a new merge request intersects part of an old merged block.
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              ...clearConditionalFormatRequests,
              ...clearProtectedRangeRequests,
              ...clearAvgColorRules,
              { unmergeCells: { range: { sheetId: lineupsSheetId } } },
              { unmergeCells: { range: { sheetId: kicksSheetId } } },
              {
                updateCells: {
                  range: { sheetId: lineupsSheetId },
                  fields: 'userEnteredFormat,dataValidation',
                },
              },
              {
                updateCells: {
                  range: { sheetId: kicksSheetId },
                  fields: 'userEnteredFormat,dataValidation',
                },
              },
            ],
          },
        });

        if (!preserveData) {
          // Full rebuild: clear values first so stale blocks are removed.
          await Promise.all([
            sheets.spreadsheets.values.clear({
              spreadsheetId,
              range: lineupsSheetName,
            }),
            sheets.spreadsheets.values.clear({
              spreadsheetId,
              range: kicksSheetName,
            }),
          ]);

          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${lineupsSheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: lineupsGrid.mergedValues },
          });

          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${kicksSheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: kicksMergedValues },
          });
        } else {
          // Format-only mode: keep existing rows/tags, only refresh header rows.
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${lineupsSheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: lineupsGrid.mergedValues.slice(0, 2) },
          });

          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${kicksSheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: kicksMergedValues.slice(0, 2) },
          });
        }

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: lineupsGrid.allRequests },
        });

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: kicksRequests },
        });

        // Apply per-clan background colors to the "Last Clan" column (D) and Fame/Atk gradient (E) on the averages sheet.
        // TODO move to place where it runs elsewhere too.
        if (avgSheetId !== null) {
          const avgColorRules: object[] = [
            buildFameAtkGradientRule(avgSheetId),
            ...allClanOrder.map((clan) => {
              const meta = allClanThemeMap.get(clan);
              const isL2W = Boolean(meta?.isL2W);
              const theme = meta?.theme;
              return {
                addConditionalFormatRule: {
                  rule: {
                    ranges: [
                      {
                        sheetId: avgSheetId,
                        startRowIndex: 1,
                        endRowIndex: 2000,
                        startColumnIndex: 2,
                        endColumnIndex: 3,
                      },
                    ],
                    booleanRule: {
                      condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=$D2="${clan}"` }] },
                      format: {
                        backgroundColor: isL2W ? L2W_ACCENT_BG : (theme?.backgroundColor ?? LINEUP_HEADER_BG),
                        textFormat: {
                          foregroundColor: isL2W
                            ? L2W_ACCENT_TEXT
                            : (theme?.textColor ?? { red: 0, green: 0, blue: 0 }),
                        },
                      },
                    },
                  },
                  index: 0,
                },
              };
            }),
          ];

          if (avgColorRules.length > 0) {
            await sheets.spreadsheets.batchUpdate({
              spreadsheetId,
              requestBody: { requests: avgColorRules },
            });
          }
        }

        await interaction.editReply({
          content: preserveData
            ? `✅ Formatting refreshed on **${lineupsSheetName}** and **${kicksSheetName}** (existing rows preserved). Clan order: **${resolvedOrder.join(' → ')}**`
            : `✅ **${lineupsSheetName}** and **${kicksSheetName}** updated with ${resolvedOrder.length} clan(s): **${resolvedOrder.join(' → ')}**`,
        });
      }

      // ── refresh ──────────────────────────────────────────────────────────────
      if (subcommand === 'refresh') {
        const league = interaction.options.getString('league', true) as '5k' | '4k';
        const spreadsheetId = await getSpreadsheetId(guild.id);
        if (!spreadsheetId) {
          await interaction.editReply({ content: '❌ Spreadsheet ID not configured.' });
          return;
        }

        await interaction.editReply({ content: `⏳ Refreshing ${league} sheets…` });

        // Sequential single cycle:
        // 1) Available checkboxes may mark players as L2W/Inactive.
        // 2) L2W rebuild processes its own checkboxes, then rebuilds from fresh DB state.
        // 3) Available rebuild again so returned players reappear immediately.
        await refreshAvailableSheet(guild.id, spreadsheetId, `${league} Available`, league);
        await tryRefreshL2WSheet(guild.id, spreadsheetId, league);
        await refreshAvailableSheet(guild.id, spreadsheetId, `${league} Available`, league);

        await interaction.editReply({
          content: `✅ **${league} Available** and **${league} L2W | Inactive** refreshed.`,
        });
      }

      // ── mark ─────────────────────────────────────────────────────────────
      if (subcommand === 'mark') {
        const playerInput = interaction.options.getString('player', true);
        const status = interaction.options.getString('status', true) as 'l2w' | 'inactive' | 'available';
        const league = interaction.options.getString('league', true) as '5k' | '4k';
        const notes = interaction.options.getString('notes') ?? null;
        const durationInput = interaction.options.getString('duration-days') ?? null;

        // Validate duration format if provided
        if (durationInput && !/^\d+$/.test(durationInput)) {
          await interaction.editReply({
            content: `❌ Invalid duration format. Use a number of days (e.g. \`30\`).`,
          });
          return;
        }

        const resolved = await resolvePlayerInput(guild.id, playerInput);
        if ('error' in resolved) {
          await interaction.editReply({ content: resolved.error });
          return;
        }

        const spreadsheetId = await getSpreadsheetId(guild.id);

        // ── Available: clear L2W/Inactive status across all leagues ──────────
        if (status === 'available') {
          // Look up all leagues where this player is currently marked so we know which sheets to refresh.
          const leagueRes = await pool.query<{ league: string }>(
            `SELECT DISTINCT league FROM player_availability WHERE guild_id = $1 AND playertag = $2 AND l2w_status IS NOT NULL`,
            [guild.id, resolved.tag],
          );
          const playerLeagues = leagueRes.rows
            .map((r) => r.league)
            .filter((lg): lg is '5k' | '4k' => lg === '5k' || lg === '4k');

          await pool.query(buildRemoveL2WPlayerAllLeagues(guild.id, resolved.tag));
          await interaction.editReply({
            content: `✅ Marked **${resolved.name}** (\`${resolved.tag}\`) as **Available**. Refreshing sheets…`,
          });

          if (spreadsheetId) {
            const leaguesToRefresh: ('5k' | '4k')[] = playerLeagues.length > 0 ? playerLeagues : [league];
            await Promise.all(
              leaguesToRefresh.flatMap((lg) => [
                tryRefreshL2WSheet(guild.id, spreadsheetId, lg),
                refreshAvailableSheet(guild.id, spreadsheetId, `${lg} Available`, lg),
              ]),
            );
          }
          await interaction.editReply({
            content: `✅ Marked **${resolved.name}** (\`${resolved.tag}\`) as **Available**.`,
          });
          return;
        }

        // ── L2W / Inactive ─────────────────────────────────────────────────
        const data: UpsertL2WPlayerData = {
          playertag: resolved.tag,
          playerName: resolved.name,
          status,
          league,
          notes,
          durationDays: durationInput,
          markedByDiscordId: interaction.user.id,
        };
        await pool.query(buildUpsertL2WPlayer(guild.id, data));

        const statusLabel = status === 'l2w' ? 'L2W' : 'Inactive';
        const durationLabel = durationInput ? ` (until ${durationInput} days)` : '';
        await interaction.editReply({
          content: `✅ Marked **${resolved.name}** (\`${resolved.tag}\`) as **${statusLabel}**${durationLabel} on the ${league} sheet. Refreshing sheet…`,
        });

        if (spreadsheetId) {
          await interaction.editReply({
            content: `✅ Marked **${resolved.name}** (\`${resolved.tag}\`) as **${statusLabel}**${durationLabel} on the ${league} sheet. Refreshing sheets…`,
          });
          // Refresh both sheets for this league — player leaves Available and enters L2W
          await Promise.all([
            tryRefreshL2WSheet(guild.id, spreadsheetId, league),
            refreshAvailableSheet(guild.id, spreadsheetId, `${league} Available`, league),
          ]);
        }
        await interaction.editReply({
          content: `✅ Marked **${resolved.name}** (\`${resolved.tag}\`) as **${statusLabel}**${durationLabel} on the ${league} sheet.`,
        });
      }

      if (subcommand === 'roles') {
        const spreadsheetId = await getSpreadsheetId(guild.id);
        if (!spreadsheetId) {
          await interaction.editReply({
            content: '❌ Spreadsheet ID not configured. Please ask an admin to set it up.',
          });
          return;
        }

        await interaction.editReply({ content: '⏳ Reading the averages sheets and checking member roles…' });

        const { error, computation } = await computeAverageRoleChanges(guild, spreadsheetId);
        if (error || !computation) {
          await interaction.editReply({ content: `❌ ${error ?? 'Could not compute average roles.'}` });
          return;
        }

        const embeds = buildPreviewEmbeds(computation);

        if (computation.totalChanges === 0) {
          await interaction.editReply({ content: '', embeds });
          return;
        }

        const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(makeCustomId('b', 'averageRoles_send', guild.id, { ownerId: interaction.user.id }))
            .setLabel('Apply Roles & Send')
            .setStyle(ButtonStyle.Success),
        );

        await interaction.editReply({ content: '', embeds, components: [confirmRow] });
      }
    } finally {
      runningGuilds.delete(guild.id);
    }
  },
};

export default command;
