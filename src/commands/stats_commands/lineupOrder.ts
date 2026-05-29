import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { normalizeTag } from '../../api/CR_API.js';
import { pool } from '../../db.js';
import { getAuthenticatedSheetsClient } from '../../features/stats/statsUtil.js';

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

// Clan title row colors
const LINEUP_TITLE_BG = { red: 0.27, green: 0.51, blue: 0.71 }; // blue
const LINEUP_TITLE_COLOR = { red: 1, green: 1, blue: 1 }; // white text
const LINEUP_TITLE_FONT_SIZE = 12;

// Column header row color
const LINEUP_HEADER_BG = { red: 0.85, green: 0.85, blue: 0.85 }; // light gray

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the values grid and formatting requests for a single clan block.
 * clanIndex determines the horizontal offset (each block is LINEUP_BLOCK_WIDTH cols wide).
 */
function buildClanBlock(clanName: string, clanIndex: number, sheetId: number) {
  const startCol = clanIndex * LINEUP_BLOCK_WIDTH;

  // --- Values: (2 + LINEUP_DATA_ROWS) rows × LINEUP_BLOCK_WIDTH cols ---
  const values: string[][] = [];

  // Row 0: clan title (first cell holds name; rest empty — merge handles display)
  values.push([clanName, ...Array(LINEUP_BLOCK_WIDTH - 1).fill('')]);

  // Row 1: column headers + empty gap cell
  values.push([...LINEUP_COL_HEADERS, '']);

  // Rows 2–(1 + LINEUP_DATA_ROWS): numbered player rows
  for (let i = 1; i <= LINEUP_DATA_ROWS; i++) {
    const tagCol = colToLetter(startCol + 1); // e.g. clan 0 → B, clan 1 → I
    const nameFormula = `=XLOOKUP(${tagCol}${i + 2}, '5k Averages'!B:B, '5k Averages'!C:C, "N/A")`; // looks up name by tag from averages sheet
    const fameAtkFormula = `=XLOOKUP(${tagCol}${i + 2}, '5k Averages'!B:B, '5k Averages'!E:E, "N/A")`; // looks up fame/atk by tag from averages sheet
    values.push([String(i), '', nameFormula, '', '', fameAtkFormula, '']);
  }

  // Row (2 + LINEUP_DATA_ROWS): "Clan Avg" summary row
  // — col 4 (Cur. Clan) holds the label, col 5 (Fame / Atk.) is left blank for the value
  const clanAvgFormula = `=ROUND(AVERAGE(IFNA(${colToLetter(startCol + 5)}3:${colToLetter(startCol + 5)}${2 + LINEUP_DATA_ROWS}, "")), 2)`; // =ROUND(AVERAGE(IFNA(F3:F54, "")), 2)
  values.push(['', '', '', '', 'Clan Avg', clanAvgFormula, '']);

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
          backgroundColor: LINEUP_TITLE_BG,
          textFormat: { bold: true, foregroundColor: LINEUP_TITLE_COLOR, fontSize: LINEUP_TITLE_FONT_SIZE },
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    },
  });

  // 3. Format column headers row (gray bg, bold, centered)
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
          backgroundColor: LINEUP_HEADER_BG,
          textFormat: { bold: true },
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

  // 6. Format "Clan Avg" row — gray bg + bold on cols 4 (Cur. Clan) and 5 (Fame / Atk.)
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
          textFormat: { bold: true },
          horizontalAlignment: 'CENTER',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
    },
  });

  // 7. Column widths — all 7 cols including the gap separator
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

  return { values, requests };
}

// ─────────────────────────────────────────────────────────────────────────────

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Manage stats sheets')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('lineup-order')
        .setDescription('Clan order for lineups. Must be linked.')
        .addStringOption((option) =>
          option.setName('sheet-name').setDescription('Lineups sheet name').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('clan-order')
            .setDescription('Comma-separated clan order (e.g. "ClanA,ClanB,ClanC")')
            .setRequired(true),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;

    if (subcommand === 'lineup-order') {
      const sheetName = interaction.options.getString('sheet-name', true);
      const clanOrderInput = interaction.options.getString('clan-order', true);
      const clanOrder = clanOrderInput.split(',').map((clan) => clan.trim());

      // Filter out l2w
      const clansToLookup = clanOrder.filter((clan) => clan.toLowerCase() !== 'l2w');

      const normalizedInputs = clansToLookup.map((clan) => ({ original: clan, normalized: normalizeTag(clan) }));

      const tags = normalizedInputs.map((c) => c.normalized);
      const abbrevs = normalizedInputs.map((c) => c.original.toLowerCase());

      const clanRes = await pool.query(
        `
        SELECT clantag, LOWER(abbreviation) AS abbreviation
          FROM clans
        WHERE guild_id = $1
          AND (clantag = ANY($2) OR LOWER(abbreviation) = ANY($3))
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
      // Hardcoded for now.
      // TODO change
      const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
      if (!spreadsheetId) {
        await interaction.editReply({
          content: '❌ Spreadsheet ID not configured. Please ask an admin to set it up.',
        });
        return;
      }

      // Get sheet ID by name
      const sheetRes = await sheets.spreadsheets.get({ spreadsheetId });
      const sheet = sheetRes.data.sheets?.find((s) => s.properties?.title === sheetName);
      if (!sheet || !sheet.properties || sheet.properties.sheetId == null) {
        await interaction.editReply({
          content: `❌ Sheet with name "${sheetName}" not found in the spreadsheet.`,
        });
        return;
      }

      const sheetId = sheet.properties.sheetId;

      // Map each clan in order to its display name (abbreviation uppercased; l2w preserved)
      const resolvedOrder = clanOrder.map((input) => {
        if (input.toLowerCase() === 'l2w') return 'L2W';
        const match = clanRes.rows.find(
          (r) => r.clantag === normalizeTag(input) || r.abbreviation === input.toLowerCase(),
        );
        return (match?.abbreviation ?? input).toUpperCase();
      });

      // Accumulate values grid and requests across all clan blocks
      const allRequests: object[] = [];
      // +1 for the "Clan Avg" summary row below the player rows
      const mergedValues: string[][] = Array(3 + LINEUP_DATA_ROWS)
        .fill(null)
        .map(() => []);

      for (let i = 0; i < resolvedOrder.length; i++) {
        const { values, requests } = buildClanBlock(resolvedOrder[i], i, sheetId);
        for (let row = 0; row < values.length; row++) {
          mergedValues[row].push(...values[row]);
        }
        allRequests.push(...requests);
      }

      // Write all values in one call
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: mergedValues },
      });

      // Apply all formatting, merges, checkbox validations, and column widths
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: allRequests },
      });

      await interaction.editReply({
        content: `✅ Lineup sheet "${sheetName}" updated with ${resolvedOrder.length} clan(s): **${resolvedOrder.join(' → ')}**`,
      });
    }
  },
};

export default command;

function colToLetter(index: number): string {
  let letter = '';
  index += 1; // 1-based
  while (index > 0) {
    index--;
    letter = String.fromCharCode(65 + (index % 26)) + letter;
    index = Math.floor(index / 26);
  }
  return letter;
}
