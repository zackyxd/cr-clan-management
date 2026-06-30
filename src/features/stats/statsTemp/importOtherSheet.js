"use strict";
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var statsUtil_js_1 = require("../statsUtil.js");
var sourceSheets = await (0, statsUtil_js_1.getAuthenticatedSheetsClient)();
var sourceData = await sourceSheets.spreadsheets.values.get({
    spreadsheetId: '1b8BgwkPZ2cUgUvy_2r5zISCSxG207qtIf7re3sVL8x0',
    range: '5k Averages!A1:LF1600',
});
var rows = sourceData.data.values || [];
var headerRow = rows[0]; // ['Tag', 'Player', 'Last Clan', 'Fame / Atk.', '132-3', '', '132-2', '', ...]
// Grab only the season-week headers starting from column index 4
// They come in pairs: '132-3', '', '132-2', '', etc.
// So filter every other one (the non-empty ones)
var seasonWeekHeaders = [];
var headerValues = [['Discord', 'Tag', 'Player', 'Last Clan', 'Fame / Atk.']];
for (var i = 4; i < headerRow.length; i += 2) {
    var label = headerRow[i];
    if (label)
        seasonWeekHeaders.push(label); // ['132-3', '132-2', '132-1', '131-4', ...]
}
var mergeRequests = [];
for (var i = 0; i < seasonWeekHeaders.length; i++) {
    var startCol = 5 + i * 2; // F=5, H=7, J=9, etc.
    var endCol = startCol + 2;
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
var sheets = await (0, statsUtil_js_1.getAuthenticatedSheetsClient)();
var targetSpreadsheetId = '1-cfoEP2snXbZuoc37jKjhKMAFkkBcr6REGKoXd5aVug';
// rows[0] is the header, rows[1+] is data
var dataRows = rows.slice(1).map(function (row) {
    var _a, _b, _c, _d, _e, _f;
    // Source columns: Tag(0), Player(1), Last Clan(2), Fame/Atk(3), then pairs from col 4
    var tag = '#' + ((_a = row[0]) !== null && _a !== void 0 ? _a : '');
    var player = (_b = row[1]) !== null && _b !== void 0 ? _b : '';
    var lastClan = (_c = row[2]) !== null && _c !== void 0 ? _c : '';
    var fameAvg = (_d = row[3]) !== null && _d !== void 0 ? _d : ''; // This is a formula result - comes as the computed value
    // Season-week data: each pair is fame(col 4+i*2), attacks(col 5+i*2)
    var weekData = [];
    for (var i = 0; i < seasonWeekHeaders.length; i++) {
        weekData.push((_e = row[4 + i * 2]) !== null && _e !== void 0 ? _e : '', (_f = row[5 + i * 2]) !== null && _f !== void 0 ? _f : '');
    }
    return __spreadArray(['', tag, player, lastClan, fameAvg], weekData, true); // Column A (Discord) left blank
});
await sheets.spreadsheets.values.update({
    spreadsheetId: targetSpreadsheetId,
    range: 'Sheet1!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
        values: __spreadArray([headerValues[0]], dataRows, true),
    },
});
await sheets.spreadsheets.batchUpdate({
    spreadsheetId: targetSpreadsheetId,
    requestBody: {
        requests: mergeRequests,
    },
});
