// import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
// import { Command } from '../../types/Command.js';
// import { checkPerms } from '../../utils/checkPermissions.js';
// import { normalizeTag, getPlayer, isFetchError } from '../../api/CR_API.js';
// import { pool } from '../../db.js';
// import {
//   getAuthenticatedSheetsClient,
//   colToLetter,
//   getSheetIdByName,
//   getSpreadsheetId,
// } from '../../features/stats/statsUtil.js';
// import { refreshAvailableSheet } from '../../features/stats/availableSheet.js';
// import { processL2WSheetCheckboxes, buildL2WSheet } from '../../features/stats/l2wSheet.js';
// import { buildUpsertL2WPlayer, buildRemoveL2WPlayer, type UpsertL2WPlayerData } from '../../sql_queries/playerL2W.js';
// import { buildUpsertLeagueAssignment, buildRemoveLeagueAssignment } from '../../sql_queries/playerLeagueAssignments.js';

// // ─── Lineup Sheet Layout Config ───────────────────────────────────────────────

// // Number of data columns per clan block
// const LINEUP_COLS_PER_CLAN = 6;
// // Total width per block including the 1-column gap separator
// const LINEUP_BLOCK_WIDTH = 7; // LINEUP_COLS_PER_CLAN + 1
// // Number of player rows per clan
// const LINEUP_DATA_ROWS = 52;

// // Column header labels — index matches relative position (0–5) within each block
// const LINEUP_COL_HEADERS = ['#', 'Tag', 'Player', 'Keep ✓', 'Cur. Clan', 'Fame / Atk.'];

// // Pixel widths for each column in the block (0–5 = data cols, 6 = gap separator)
// const LINEUP_COL_WIDTHS = [
//   25, // 0: #
//   95, // 1: Tag
//   135, // 2: Player
//   60, // 3: ✓ (checkbox)
//   95, // 4: Clan
//   80, // 5: Fame / Atk
//   20, // 6: gap separator
// ];

// // Clan title row colors
// const LINEUP_TITLE_BG = { red: 0.27, green: 0.51, blue: 0.71 }; // blue
// const LINEUP_TITLE_COLOR = { red: 1, green: 1, blue: 1 }; // white text
// const LINEUP_TITLE_FONT_SIZE = 12;

// // Column header row color
// const LINEUP_HEADER_BG = { red: 0.85, green: 0.85, blue: 0.85 }; // light gray

// // ─────────────────────────────────────────────────────────────────────────────

// /**
//  * Builds the values grid and formatting requests for a single clan block.
//  * clanIndex determines the horizontal offset (each block is LINEUP_BLOCK_WIDTH cols wide).
//  */
// function buildClanBlock(clanName: string, clanIndex: number, sheetId: number, l2wSheetsExist = false) {
//   const startCol = clanIndex * LINEUP_BLOCK_WIDTH;

//   // --- Values: (2 + LINEUP_DATA_ROWS) rows × LINEUP_BLOCK_WIDTH cols ---
//   const values: string[][] = [];

//   // Row 0: clan title (first cell holds name; rest empty — merge handles display)
//   values.push([clanName, ...Array(LINEUP_BLOCK_WIDTH - 1).fill('')]);

//   // Row 1: column headers + empty gap cell
//   values.push([...LINEUP_COL_HEADERS, '']);

//   // Rows 2–(1 + LINEUP_DATA_ROWS): numbered player rows
//   for (let i = 1; i <= LINEUP_DATA_ROWS; i++) {
//     const tagCol = colToLetter(startCol + 1); // e.g. clan 0 → B, clan 1 → I
//     const nameFormula = `=XLOOKUP(${tagCol}${i + 2}, '5k Averages'!B:B, '5k Averages'!C:C, "N/A")`; // looks up name by tag from averages sheet
//     const fameAtkFormula = `=XLOOKUP(${tagCol}${i + 2}, '5k Averages'!B:B, '5k Averages'!E:E, "N/A")`; // looks up fame/atk by tag from averages sheet
//     values.push([String(i), '', nameFormula, '', '', fameAtkFormula, '']);
//   }

//   // Row (2 + LINEUP_DATA_ROWS): "Clan Avg" summary row
//   // — col 4 (Cur. Clan) holds the label, col 5 (Fame / Atk.) is left blank for the value
//   const clanAvgFormula = `=IFERROR(ROUND(AVERAGE(IFNA(${colToLetter(startCol + 5)}3:${colToLetter(startCol + 5)}${2 + LINEUP_DATA_ROWS}, "")), 2), "No Scores")`;
//   values.push(['', 'Avg Wanted:', '', '', 'Clan Avg', clanAvgFormula, '']);

//   // --- Requests ---
//   const requests: object[] = [];

//   // 1. Merge clan title across the 6 data columns (excludes gap)
//   requests.push({
//     mergeCells: {
//       range: {
//         sheetId,
//         startRowIndex: 0,
//         endRowIndex: 1,
//         startColumnIndex: startCol,
//         endColumnIndex: startCol + LINEUP_COLS_PER_CLAN,
//       },
//       mergeType: 'MERGE_ALL',
//     },
//   });

//   // 2. Format clan title row (colored bg, white bold centered text)
//   requests.push({
//     repeatCell: {
//       range: {
//         sheetId,
//         startRowIndex: 0,
//         endRowIndex: 1,
//         startColumnIndex: startCol,
//         endColumnIndex: startCol + LINEUP_COLS_PER_CLAN,
//       },
//       cell: {
//         userEnteredFormat: {
//           backgroundColor: LINEUP_TITLE_BG,
//           textFormat: { bold: true, foregroundColor: LINEUP_TITLE_COLOR, fontSize: LINEUP_TITLE_FONT_SIZE },
//           horizontalAlignment: 'CENTER',
//           verticalAlignment: 'MIDDLE',
//         },
//       },
//       fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
//     },
//   });

//   // 3. Format column headers row (gray bg, bold, centered)
//   requests.push({
//     repeatCell: {
//       range: {
//         sheetId,
//         startRowIndex: 1,
//         endRowIndex: 2,
//         startColumnIndex: startCol,
//         endColumnIndex: startCol + LINEUP_COLS_PER_CLAN,
//       },
//       cell: {
//         userEnteredFormat: {
//           backgroundColor: LINEUP_HEADER_BG,
//           textFormat: { bold: true },
//           horizontalAlignment: 'CENTER',
//         },
//       },
//       fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
//     },
//   });

//   // 4. Checkbox data validation for the ✓ column (relative col 3)
//   requests.push({
//     setDataValidation: {
//       range: {
//         sheetId,
//         startRowIndex: 2,
//         endRowIndex: 2 + LINEUP_DATA_ROWS,
//         startColumnIndex: startCol + 3,
//         endColumnIndex: startCol + 4,
//       },
//       rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true },
//     },
//   });

//   // 5. Center-align all data rows (rows 2 through 1 + LINEUP_DATA_ROWS)
//   requests.push({
//     repeatCell: {
//       range: {
//         sheetId,
//         startRowIndex: 2,
//         endRowIndex: 2 + LINEUP_DATA_ROWS,
//         startColumnIndex: startCol,
//         endColumnIndex: startCol + LINEUP_COLS_PER_CLAN,
//       },
//       cell: {
//         userEnteredFormat: { horizontalAlignment: 'CENTER', numberFormat: { type: 'TEXT' } },
//       },
//       fields: 'userEnteredFormat(horizontalAlignment,numberFormat)',
//     },
//   });

//   // 6. Format the "Avg Wanted:" label in the summary row to be right-aligned and italic
//   requests.push({
//     repeatCell: {
//       range: {
//         sheetId,
//         startRowIndex: 2 + LINEUP_DATA_ROWS,
//         endRowIndex: 3 + LINEUP_DATA_ROWS,
//         startColumnIndex: startCol + 1,
//         endColumnIndex: startCol + 2, // includes the label and the 4 empty cells before the avg value
//       },
//       cell: {
//         userEnteredFormat: {
//           horizontalAlignment: 'RIGHT',
//           textFormat: { italic: true },
//         },
//       },
//       fields: 'userEnteredFormat(horizontalAlignment,textFormat)',
//     },
//   });

//   // 7. Format "Clan Avg" row — gray bg + bold on cols 4 (Cur. Clan) and 5 (Fame / Atk.)
//   requests.push({
//     repeatCell: {
//       range: {
//         sheetId,
//         startRowIndex: 2 + LINEUP_DATA_ROWS,
//         endRowIndex: 3 + LINEUP_DATA_ROWS,
//         startColumnIndex: startCol + 4,
//         endColumnIndex: startCol + 6,
//       },
//       cell: {
//         userEnteredFormat: {
//           backgroundColor: LINEUP_HEADER_BG,
//           textFormat: { bold: true, italic: true },
//           horizontalAlignment: 'RIGHT',
//         },
//       },
//       fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
//     },
//   });

//   // 8. Column widths — all 7 cols including the gap separator
//   for (let col = 0; col < LINEUP_BLOCK_WIDTH; col++) {
//     requests.push({
//       updateDimensionProperties: {
//         range: {
//           sheetId,
//           dimension: 'COLUMNS',
//           startIndex: startCol + col,
//           endIndex: startCol + col + 1,
//         },
//         properties: { pixelSize: LINEUP_COL_WIDTHS[col] },
//         fields: 'pixelSize',
//       },
//     });
//   }

//   // 9. Conditional format: Fame/Atk is -15 or more BELOW the avg wanted → light red
//   //
//   //  Formula breakdown (e.g. clan 0):
//   //    fameCol   = F  — the Fame/Atk column being formatted (startCol + 5)
//   //    F3        — the cell being evaluated; Sheets auto-adjusts per row (F4, F5...)
//   //    C$56      — the fixed "Avg Wanted" reference cell (startCol+2, row 55 0-indexed = 56 1-indexed)
//   //    ISNUMBER  — skip non-numeric cells like "N/A" text
//   //    F3<=C$56-15  — fame value is 15 or more below the avg wanted
//   const fameCol = colToLetter(startCol + 5); // e.g. F for clan 0
//   const avgWantedCol = colToLetter(startCol + 2); // e.g. C for clan 0 (col 2 within block)
//   const avgWantedRef = `${avgWantedCol}$${3 + LINEUP_DATA_ROWS}`; // e.g. C$56

//   requests.push({
//     addConditionalFormatRule: {
//       rule: {
//         ranges: [
//           {
//             sheetId,
//             startRowIndex: 2,
//             endRowIndex: 2 + LINEUP_DATA_ROWS,
//             startColumnIndex: startCol + 5,
//             endColumnIndex: startCol + 6,
//           },
//         ],
//         booleanRule: {
//           condition: {
//             type: 'CUSTOM_FORMULA',
//             values: [
//               {
//                 userEnteredValue: `=AND(ISNUMBER(${fameCol}3),ISNUMBER(${avgWantedRef}),${fameCol}3<=${avgWantedRef}-15)`,
//               },
//             ],
//           },
//           format: { backgroundColor: { red: 0.96, green: 0.8, blue: 0.8 } }, // light red
//         },
//       },
//       index: 0,
//     },
//   });

//   // 10. Conditional format: Fame/Atk is +25 or more ABOVE the avg wanted → light green
//   requests.push({
//     addConditionalFormatRule: {
//       rule: {
//         ranges: [
//           {
//             sheetId,
//             startRowIndex: 2,
//             endRowIndex: 2 + LINEUP_DATA_ROWS,
//             startColumnIndex: startCol + 5,
//             endColumnIndex: startCol + 6,
//           },
//         ],
//         booleanRule: {
//           condition: {
//             type: 'CUSTOM_FORMULA',
//             values: [
//               {
//                 userEnteredValue: `=AND(ISNUMBER(${fameCol}3),ISNUMBER(${avgWantedRef}),${fameCol}3>=${avgWantedRef}+25)`,
//               },
//             ],
//           },
//           format: { backgroundColor: { red: 0.85, green: 0.93, blue: 0.83 } }, // light green
//         },
//       },
//       index: 0,
//     },
//   });

//   // 11. Conditional format: Player Name is orange if the player is on the L2W | Inactive sheet.
//   //   Only added when both L2W sheets already exist — the Sheets API rejects cross-sheet
//   //   CUSTOM_FORMULA references to sheets that don't exist yet.
//   const tagCol = colToLetter(startCol + 1); // Tag column for this clan block
//   const playerNameCol = colToLetter(startCol + 2); // Player Name column for this clan block
//   if (l2wSheetsExist)
//     requests.push({
//       addConditionalFormatRule: {
//         rule: {
//           ranges: [
//             {
//               sheetId,
//               startRowIndex: 2,
//               endRowIndex: 2 + LINEUP_DATA_ROWS,
//               startColumnIndex: startCol + 2,
//               endColumnIndex: startCol + 3,
//             },
//           ],
//           booleanRule: {
//             condition: {
//               type: 'CUSTOM_FORMULA',
//               values: [
//                 {
//                   userEnteredValue: `=COUNTIF(INDIRECT("'5k L2W | Inactive'!A:A"),${tagCol}3)+COUNTIF(INDIRECT("'4k L2W | Inactive'!A:A"),${tagCol}3)>0`,
//                 },
//               ],
//             },
//             format: { backgroundColor: { red: 1.0, green: 0.6, blue: 0.2 } }, // orange
//           },
//         },
//         index: 0,
//       },
//     });

//   // Suppress unused variable warning — playerNameCol is intentionally unused (range covers it)
//   void playerNameCol;
//   void l2wSheetsExist;

//   return { values, requests };
// }

// // ─── Sheet refresh helpers ───────────────────────────────────────────────────

// /** Rebuild one L2W | Inactive sheet if it already exists. No-ops silently if the tab is missing. */
// async function tryRefreshL2WSheet(guildId: string, spreadsheetId: string, league: '5k' | '4k') {
//   const sheetName = `${league} L2W | Inactive`;
//   await processL2WSheetCheckboxes(guildId, spreadsheetId, sheetName, league);
//   const sheetId = await getSheetIdByName(spreadsheetId, sheetName);
//   if (sheetId !== null) {
//     await buildL2WSheet(guildId, spreadsheetId, sheetId, sheetName, league);
//   }
// }

// // ─────────────────────────────────────────────────────────────────────────────

// const MENTION_REGEX = /^<@!?(\d+)>$/;

// /**
//  * Resolves a raw "/stats …" player argument (either a Discord @mention or a
//  * bare CR tag) to a { tag, name } pair.  Rejects with an error string if the
//  * mention maps to 0 or 2+ accounts.
//  */
// async function resolvePlayerInput(
//   guildId: string,
//   input: string,
// ): Promise<{ tag: string; name: string } | { error: string }> {
//   const mentionMatch = MENTION_REGEX.exec(input.trim());

//   if (mentionMatch) {
//     const discordId = mentionMatch[1];
//     const res = await pool.query<{ playertag: string }>(
//       `SELECT playertag FROM user_playertags WHERE guild_id = $1 AND discord_id = $2`,
//       [guildId, discordId],
//     );

//     if (res.rows.length === 0) {
//       return { error: `❌ That user has no linked CR accounts in this server.` };
//     }
//     if (res.rows.length > 1) {
//       const tagList = res.rows.map((r) => `\`${r.playertag}\``).join(', ');
//       return {
//         error: `❌ That user has ${res.rows.length} linked accounts (${tagList}). Use the player tag directly instead.`,
//       };
//     }

//     const tag = res.rows[0].playertag;
//     const player = await getPlayer(tag);
//     if (isFetchError(player)) {
//       return { error: `❌ Could not fetch player info for \`${tag}\`.` };
//     }
//     return { tag, name: player.name };
//   } else {
//     const tag = normalizeTag(input.trim());
//     if (!tag) {
//       return { error: `❌ Invalid input \`${input}\`. Provide a player tag (\`#ABC123\`) or @mention.` };
//     }
//     const player = await getPlayer(tag);
//     if (isFetchError(player)) {
//       return { error: `❌ Could not find player \`${tag}\`. Check the tag and try again.` };
//     }
//     return { tag, name: player.name };
//   }
// }

// // ─────────────────────────────────────────────────────────────────────────────

// const command: Command = {
//   data: new SlashCommandBuilder()
//     .setName('stats')
//     .setDescription('Manage stats sheets')
//     .addSubcommand((subcommand) =>
//       subcommand
//         .setName('lineup-order')
//         .setDescription('Clan order for lineups. Must be linked.')
//         .addStringOption((option) =>
//           option.setName('sheet-name').setDescription('Lineups sheet name').setRequired(true),
//         )
//         .addStringOption((option) =>
//           option
//             .setName('clan-order')
//             .setDescription('Comma-separated clan order (e.g. "ClanA,ClanB,ClanC")')
//             .setRequired(true),
//         ),
//     )
//     .addSubcommand((sub) =>
//       sub
//         .setName('refresh')
//         .setDescription('Process checkboxes and rebuild both the Available and L2W | Inactive sheets for a league')
//         .addStringOption((o) =>
//           o
//             .setName('league')
//             .setDescription('League tier')
//             .setRequired(true)
//             .addChoices({ name: '5k', value: '5k' }, { name: '4k', value: '4k' }),
//         ),
//     )
//     .addSubcommand((sub) =>
//       sub
//         .setName('mark-l2w')
//         .setDescription('Mark a player as L2W or Inactive')
//         .addStringOption((o) =>
//           o.setName('player').setDescription('Player tag (#ABC123) or @mention').setRequired(true),
//         )
//         .addStringOption((o) =>
//           o
//             .setName('status')
//             .setDescription('Status to assign')
//             .setRequired(true)
//             .addChoices({ name: 'L2W', value: 'l2w' }, { name: 'Inactive', value: 'inactive' }),
//         )
//         .addStringOption((o) =>
//           o
//             .setName('league')
//             .setDescription('League tier this player belongs to')
//             .setRequired(true)
//             .addChoices({ name: '5k', value: '5k' }, { name: '4k', value: '4k' }),
//         )
//         .addStringOption((o) => o.setName('notes').setDescription('Optional notes').setRequired(false))
//         .addStringOption((o) =>
//           o
//             .setName('duration')
//             .setDescription('Expiry date (YYYY-MM-DD) or leave blank for indefinite')
//             .setRequired(false),
//         ),
//     )
//     .addSubcommand((sub) =>
//       sub
//         .setName('unmark-l2w')
//         .setDescription('Remove a player from the L2W / Inactive list')
//         .addStringOption((o) =>
//           o.setName('player').setDescription('Player tag (#ABC123) or @mention').setRequired(true),
//         ),
//     )
//     .addSubcommand((sub) =>
//       sub
//         .setName('promote')
//         .setDescription('Override a player to the 5k league (or undo a prior promote/demote)')
//         .addStringOption((o) =>
//           o.setName('player').setDescription('Player tag (#ABC123) or @mention').setRequired(true),
//         ),
//     )
//     .addSubcommand((sub) =>
//       sub
//         .setName('demote')
//         .setDescription('Override a player to the 4k league (or undo a prior promote/demote)')
//         .addStringOption((o) =>
//           o.setName('player').setDescription('Player tag (#ABC123) or @mention').setRequired(true),
//         ),
//     ),

//   async execute(interaction: ChatInputCommandInteraction): Promise<void> {
//     const guild = interaction.guild;
//     if (!guild) {
//       await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
//       return;
//     }

//     const subcommand = interaction.options.getSubcommand();
//     const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
//       hideNoPerms: true,
//       deferEphemeral: true,
//     });
//     if (!allowed) return;

//     if (subcommand === 'lineup-order') {
//       const sheetName = interaction.options.getString('sheet-name', true);
//       const clanOrderInput = interaction.options.getString('clan-order', true);
//       const clanOrder = clanOrderInput.split(',').map((clan) => clan.trim());

//       // Filter out l2w
//       const clansToLookup = clanOrder.filter((clan) => clan.toLowerCase() !== 'l2w');

//       const normalizedInputs = clansToLookup.map((clan) => ({ original: clan, normalized: normalizeTag(clan) }));

//       const tags = normalizedInputs.map((c) => c.normalized);
//       const abbrevs = normalizedInputs.map((c) => c.original.toLowerCase());

//       const clanRes = await pool.query(
//         `
//         SELECT clantag, LOWER(abbreviation) AS abbreviation
//           FROM clans
//         WHERE guild_id = $1
//           AND (clantag = ANY($2) OR LOWER(abbreviation) = ANY($3))
//         `,
//         [guild.id, tags, abbrevs],
//       );

//       // Find which inputs had no match
//       const foundTags = new Set(clanRes.rows.map((r) => r.clantag));
//       const foundAbbrevs = new Set(clanRes.rows.map((r) => r.abbreviation));

//       const notFound = clansToLookup.filter(
//         (clan) => !foundTags.has(normalizeTag(clan)) && !foundAbbrevs.has(clan.toLowerCase()),
//       );

//       if (notFound.length > 0) {
//         await interaction.editReply({
//           content: `❌ The following clans are not linked in this server: **${notFound.join(', ')}**.\nLink them to make the lineups order.`,
//         });
//         return;
//       }

//       const sheets = await getAuthenticatedSheetsClient();
//       // Hardcoded for now.
//       // TODO change
//       const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
//       if (!spreadsheetId) {
//         await interaction.editReply({
//           content: '❌ Spreadsheet ID not configured. Please ask an admin to set it up.',
//         });
//         return;
//       }

//       // Get sheet ID by name
//       const sheetRes = await sheets.spreadsheets.get({ spreadsheetId });
//       const sheet = sheetRes.data.sheets?.find((s) => s.properties?.title === sheetName);
//       if (!sheet || !sheet.properties || sheet.properties.sheetId == null) {
//         await interaction.editReply({
//           content: `❌ Sheet with name "${sheetName}" not found in the spreadsheet.`,
//         });
//         return;
//       }

//       const sheetId = sheet.properties.sheetId;

//       // Clear any existing conditional format rules on this sheet before adding new ones.
//       // Without this, re-running the command stacks duplicate rules on top of each other.
//       const existingRules = sheet.conditionalFormats ?? [];
//       if (existingRules.length > 0) {
//         // Delete from highest index down so earlier indices don't shift mid-request
//         const deleteRequests = existingRules
//           .map((_, index) => ({ deleteConditionalFormatRule: { sheetId, index } }))
//           .reverse();
//         await sheets.spreadsheets.batchUpdate({
//           spreadsheetId,
//           requestBody: { requests: deleteRequests },
//         });
//       }

//       // Map each clan in order to its display name (abbreviation uppercased; l2w preserved)
//       const resolvedOrder = clanOrder.map((input) => {
//         if (input.toLowerCase() === 'l2w') return 'L2W';
//         const match = clanRes.rows.find(
//           (r) => r.clantag === normalizeTag(input) || r.abbreviation === input.toLowerCase(),
//         );
//         return (match?.abbreviation ?? input).toUpperCase();
//       });

//       // Check whether both L2W sheets exist so we can include the orange L2W warning rule
//       const [l2w5kId, l2w4kId] = await Promise.all([
//         getSheetIdByName(spreadsheetId, '5k L2W | Inactive'),
//         getSheetIdByName(spreadsheetId, '4k L2W | Inactive'),
//       ]);
//       const l2wSheetsExist = l2w5kId !== null && l2w4kId !== null;

//       // Accumulate values grid and requests across all clan blocks
//       const allRequests: object[] = [];
//       // +1 for the "Clan Avg" summary row below the player rows
//       const mergedValues: string[][] = Array(3 + LINEUP_DATA_ROWS)
//         .fill(null)
//         .map(() => []);

//       for (let i = 0; i < resolvedOrder.length; i++) {
//         const { values, requests } = buildClanBlock(resolvedOrder[i], i, sheetId, l2wSheetsExist);
//         for (let row = 0; row < values.length; row++) {
//           mergedValues[row].push(...values[row]);
//         }
//         allRequests.push(...requests);
//       }

//       // Write all values in one call
//       await sheets.spreadsheets.values.update({
//         spreadsheetId,
//         range: `${sheetName}!A1`,
//         valueInputOption: 'USER_ENTERED',
//         requestBody: { values: mergedValues },
//       });

//       // Apply all formatting, merges, checkbox validations, and column widths
//       await sheets.spreadsheets.batchUpdate({
//         spreadsheetId,
//         requestBody: { requests: allRequests },
//       });

//       await interaction.editReply({
//         content: `✅ Lineup sheet "${sheetName}" updated with ${resolvedOrder.length} clan(s): **${resolvedOrder.join(' → ')}**`,
//       });
//     }

//     // ── refresh ──────────────────────────────────────────────────────────────
//     if (subcommand === 'refresh') {
//       const league = interaction.options.getString('league', true) as '5k' | '4k';
//       const spreadsheetId = await getSpreadsheetId(guild.id);
//       if (!spreadsheetId) {
//         await interaction.editReply({ content: '❌ Spreadsheet ID not configured.' });
//         return;
//       }

//       await interaction.editReply({ content: `⏳ Refreshing ${league} sheets…` });

//       await Promise.all([
//         refreshAvailableSheet(guild.id, spreadsheetId, `${league} Available`, league),
//         tryRefreshL2WSheet(guild.id, spreadsheetId, league),
//       ]);

//       await interaction.editReply({
//         content: `✅ **${league} Available** and **${league} L2W | Inactive** refreshed.`,
//       });
//     }

//     // ── mark-l2w ─────────────────────────────────────────────────────────────
//     if (subcommand === 'mark-l2w') {
//       const playerInput = interaction.options.getString('player', true);
//       const status = interaction.options.getString('status', true) as 'l2w' | 'inactive';
//       const league = interaction.options.getString('league', true) as '5k' | '4k';
//       const notes = interaction.options.getString('notes') ?? null;
//       const durationInput = interaction.options.getString('duration') ?? null;

//       // Validate duration format if provided
//       if (durationInput && !/^\d{4}-\d{2}-\d{2}$/.test(durationInput)) {
//         await interaction.editReply({
//           content: `❌ Invalid duration format. Use \`YYYY-MM-DD\` (e.g. \`2026-06-15\`).`,
//         });
//         return;
//       }

//       const resolved = await resolvePlayerInput(guild.id, playerInput);
//       if ('error' in resolved) {
//         await interaction.editReply({ content: resolved.error });
//         return;
//       }

//       const data: UpsertL2WPlayerData = {
//         playertag: resolved.tag,
//         playerName: resolved.name,
//         status,
//         league,
//         notes,
//         durationDate: durationInput,
//         markedByDiscordId: interaction.user.id,
//       };
//       await pool.query(buildUpsertL2WPlayer(guild.id, data));

//       const statusLabel = status === 'l2w' ? 'L2W' : 'Inactive';
//       const durationLabel = durationInput ? ` (until ${durationInput})` : '';
//       await interaction.editReply({
//         content: `✅ Marked **${resolved.name}** (\`${resolved.tag}\`) as **${statusLabel}**${durationLabel} on the ${league} sheet. Refreshing sheet…`,
//       });

//       const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? '';
//       if (spreadsheetId) {
//         // Refresh both sheets for this league in parallel — player leaves Available and enters L2W
//         await Promise.all([
//           tryRefreshL2WSheet(guild.id, spreadsheetId, league),
//           refreshAvailableSheet(guild.id, spreadsheetId, `${league} Available`, league),
//         ]);
//       }
//       await interaction.editReply({
//         content: `✅ Marked **${resolved.name}** (\`${resolved.tag}\`) as **${statusLabel}**${durationLabel} on the ${league} sheet.`,
//       });
//     }

//     // ── unmark-l2w ───────────────────────────────────────────────────────────
//     if (subcommand === 'unmark-l2w') {
//       const playerInput = interaction.options.getString('player', true);

//       const resolved = await resolvePlayerInput(guild.id, playerInput);
//       if ('error' in resolved) {
//         await interaction.editReply({ content: resolved.error });
//         return;
//       }

//       // Look up the player's league before deleting so we know which sheets to refresh
//       const leagueRes = await pool.query<{ l2w_league: string | null }>(
//         `SELECT l2w_league FROM player_availability WHERE guild_id = $1 AND playertag = $2`,
//         [guild.id, resolved.tag],
//       );
//       const playerLeague = leagueRes.rows[0]?.l2w_league as '5k' | '4k' | null;

//       await pool.query(buildRemoveL2WPlayer(guild.id, resolved.tag));
//       await interaction.editReply({
//         content: `✅ Removed **${resolved.name}** (\`${resolved.tag}\`) from the L2W / Inactive list. Refreshing sheets…`,
//       });

//       const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? '';
//       if (spreadsheetId) {
//         const leaguesToRefresh: ('5k' | '4k')[] = playerLeague ? [playerLeague] : ['5k', '4k'];
//         await Promise.all(
//           leaguesToRefresh.flatMap((lg) => [
//             tryRefreshL2WSheet(guild.id, spreadsheetId, lg),
//             refreshAvailableSheet(guild.id, spreadsheetId, `${lg} Available`, lg),
//           ]),
//         );
//       }
//       await interaction.editReply({
//         content: `✅ Removed **${resolved.name}** (\`${resolved.tag}\`) from the L2W / Inactive list.`,
//       });
//     }

//     // ── promote / demote ─────────────────────────────────────────────────────
//     if (subcommand === 'promote' || subcommand === 'demote') {
//       const targetLeague: '5k' | '4k' = subcommand === 'promote' ? '5k' : '4k';
//       const playerInput = interaction.options.getString('player', true);

//       const resolved = await resolvePlayerInput(guild.id, playerInput);
//       if ('error' in resolved) {
//         await interaction.editReply({ content: resolved.error });
//         return;
//       }

//       const { tag, name } = resolved;

//       // Check if this player already has a league override
//       const overrideRes = await pool.query<{ league_target: string | null }>(
//         `SELECT league_target FROM player_availability WHERE guild_id = $1 AND playertag = $2`,
//         [guild.id, tag],
//       );
//       const currentOverride = overrideRes.rows[0]?.league_target ?? null;

//       const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? '';

//       if (currentOverride === targetLeague) {
//         // Already overridden to this league — undo
//         await pool.query(buildRemoveLeagueAssignment(guild.id, tag));
//         await interaction.editReply({
//           content: `✅ Removed ${targetLeague} override for **${name}** (\`${tag}\`). They'll return to their natural league. Refreshing sheets…`,
//         });
//       } else {
//         // We don't have a direct player→clan join, so fromLeague is null
//         await pool.query(buildUpsertLeagueAssignment(guild.id, tag, name, targetLeague, null, interaction.user.id));
//         const verb = subcommand === 'promote' ? 'Promoted' : 'Demoted';
//         await interaction.editReply({
//           content: `✅ ${verb} **${name}** (\`${tag}\`) to **${targetLeague}**. Refreshing sheets…`,
//         });
//       }

//       if (spreadsheetId) {
//         // Refresh all 4 sheets — player may move between leagues on both Available and L2W sheets
//         await Promise.all([
//           refreshAvailableSheet(guild.id, spreadsheetId, '5k Available', '5k'),
//           refreshAvailableSheet(guild.id, spreadsheetId, '4k Available', '4k'),
//           tryRefreshL2WSheet(guild.id, spreadsheetId, '5k'),
//           tryRefreshL2WSheet(guild.id, spreadsheetId, '4k'),
//         ]);
//       }

//       if (currentOverride === targetLeague) {
//         await interaction.editReply({
//           content: `✅ Removed ${targetLeague} override for **${name}** (\`${tag}\`). They'll return to their natural league.`,
//         });
//       } else {
//         const verb = subcommand === 'promote' ? 'Promoted' : 'Demoted';
//         await interaction.editReply({
//           content: `✅ ${verb} **${name}** (\`${tag}\`) to **${targetLeague}**. They'll appear on the ${targetLeague} Available sheet.`,
//         });
//       }
//     }
//   },
// };

// export default command;
