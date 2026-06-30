"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEADER_BG = exports.DATA_START_ROW = exports.HEADERS_ROW = exports.TITLE_ROW = void 0;
exports.getAuthenticatedSheetsClient = getAuthenticatedSheetsClient;
exports.getServiceAccountEmail = getServiceAccountEmail;
exports.getSheetIdByName = getSheetIdByName;
exports.getSpreadsheetId = getSpreadsheetId;
exports.colToLetter = colToLetter;
exports.buildUnmergeRequest = buildUnmergeRequest;
exports.buildTitleCellRequests = buildTitleCellRequests;
exports.buildHeaderRowRequest = buildHeaderRowRequest;
exports.buildColumnWidthRequests = buildColumnWidthRequests;
exports.buildFreezeRequest = buildFreezeRequest;
exports.buildCheckboxValidationRequest = buildCheckboxValidationRequest;
exports.buildClearValidationRequest = buildClearValidationRequest;
exports.buildClearConditionalFormatRequests = buildClearConditionalFormatRequests;
exports.buildProtectedRangeRequest = buildProtectedRangeRequest;
exports.buildClearProtectedRangeRequests = buildClearProtectedRangeRequests;
var google_auth_library_1 = require("google-auth-library");
var googleapis_1 = require("googleapis");
var logger_js_1 = require("../../logger.js");
require("dotenv-flow/config");
var db_js_1 = require("../../db.js");
var SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
// Create authenticated Google Sheets client
function getAuthenticatedSheetsClient() {
    return __awaiter(this, void 0, void 0, function () {
        var auth, sheets;
        return __generator(this, function (_a) {
            try {
                auth = new google_auth_library_1.GoogleAuth({
                    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
                    scopes: SCOPES,
                });
                sheets = googleapis_1.google.sheets({ version: 'v4', auth: auth });
                return [2 /*return*/, sheets];
            }
            catch (error) {
                logger_js_1.default.error('Failed to authenticate with Google Sheets API:', error);
                throw error;
            }
            return [2 /*return*/];
        });
    });
}
/** Returns the bot's service-account email, so it can be added as an editor on protected ranges it creates. */
function getServiceAccountEmail() {
    return __awaiter(this, void 0, void 0, function () {
        var auth, credentials;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    auth = new google_auth_library_1.GoogleAuth({
                        keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH,
                        scopes: SCOPES,
                    });
                    return [4 /*yield*/, auth.getCredentials()];
                case 1:
                    credentials = _a.sent();
                    if (!credentials.client_email) {
                        throw new Error('Service account credentials are missing client_email');
                    }
                    return [2 /*return*/, credentials.client_email];
            }
        });
    });
}
/** Returns the numeric sheetId for a tab by its display name, or null if not found. */
function getSheetIdByName(spreadsheetId, sheetName) {
    return __awaiter(this, void 0, void 0, function () {
        var sheets, res, sheet;
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0: return [4 /*yield*/, getAuthenticatedSheetsClient()];
                case 1:
                    sheets = _d.sent();
                    return [4 /*yield*/, sheets.spreadsheets.get({ spreadsheetId: spreadsheetId })];
                case 2:
                    res = _d.sent();
                    sheet = (_a = res.data.sheets) === null || _a === void 0 ? void 0 : _a.find(function (s) { var _a; return ((_a = s.properties) === null || _a === void 0 ? void 0 : _a.title) === sheetName; });
                    return [2 /*return*/, (_c = (_b = sheet === null || sheet === void 0 ? void 0 : sheet.properties) === null || _b === void 0 ? void 0 : _b.sheetId) !== null && _c !== void 0 ? _c : null];
            }
        });
    });
}
function getSpreadsheetId(guildId) {
    return __awaiter(this, void 0, void 0, function () {
        var res;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, db_js_1.pool.query("\n    SELECT stats_spreadsheetid\n    FROM server_settings\n    WHERE guild_id = $1\n    ", [guildId])];
                case 1:
                    res = _c.sent();
                    return [2 /*return*/, (_b = (_a = res.rows[0]) === null || _a === void 0 ? void 0 : _a.stats_spreadsheetid) !== null && _b !== void 0 ? _b : ''];
            }
        });
    });
}
/** Converts a 0-based column index to a letter (A, B, …, Z, AA, …). */
function colToLetter(index) {
    var letter = '';
    var i = index + 1;
    while (i > 0) {
        i--;
        letter = String.fromCharCode(65 + (i % 26)) + letter;
        i = Math.floor(i / 26);
    }
    return letter;
}
// ─── Shared Sheet Layout Conventions ───────────────────────────────────────────
// Every stats sheet (Available, L2W/Inactive, Averages, etc.) follows the same
// 3-row layout: a merged title row, a header row, then data starting on row 3.
/** 0-based row index of the colored title row (row 1 in A1 notation). */
exports.TITLE_ROW = 0;
/** 0-based row index of the column-header row (row 2 in A1 notation). */
exports.HEADERS_ROW = 1;
/** 0-based row index where data begins (row 3 in A1 notation). */
exports.DATA_START_ROW = 2;
/** Standard gray background used for column-header rows across stats sheets. */
exports.HEADER_BG = { red: 0.85, green: 0.85, blue: 0.85 };
// ─── Shared Sheets API Request Builders ────────────────────────────────────────
// These return raw batchUpdate request objects (or arrays of them) for formatting
// patterns repeated across every stats sheet builder, so each sheet file only
// needs to describe what's different about it (colors, columns, row counts).
/** Removes an existing merge over the given range so re-running a sheet build doesn't error on "already merged" cells. */
function buildUnmergeRequest(sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex) {
    return {
        unmergeCells: {
            range: { sheetId: sheetId, startRowIndex: startRowIndex, endRowIndex: endRowIndex, startColumnIndex: startColumnIndex, endColumnIndex: endColumnIndex },
        },
    };
}
/**
 * Builds the title-row formatting: a bold, centered, colored banner across
 * [startColumnIndex, endColumnIndex), merged into one cell across
 * [mergeStartColumnIndex, endColumnIndex). Used for the colored "section header"
 * banner at the top of each sheet (e.g. "5k Available", "L2W").
 *
 * `mergeStartColumnIndex` defaults to `startColumnIndex`, but can start later —
 * e.g. the Available sheet colors the whole title row (cols 0-7) but only merges
 * cols 2-7, leaving the frozen Tag/Player columns as separate colored cells.
 */
function buildTitleCellRequests(sheetId, startColumnIndex, endColumnIndex, backgroundColor, foregroundColor, mergeStartColumnIndex) {
    if (mergeStartColumnIndex === void 0) { mergeStartColumnIndex = startColumnIndex; }
    return [
        {
            repeatCell: {
                range: { sheetId: sheetId, startRowIndex: exports.TITLE_ROW, endRowIndex: exports.TITLE_ROW + 1, startColumnIndex: startColumnIndex, endColumnIndex: endColumnIndex },
                cell: {
                    userEnteredFormat: {
                        backgroundColor: backgroundColor,
                        textFormat: { bold: true, foregroundColor: foregroundColor, fontSize: 12 },
                        horizontalAlignment: 'CENTER',
                        verticalAlignment: 'MIDDLE',
                    },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
            },
        },
        {
            mergeCells: {
                range: {
                    sheetId: sheetId,
                    startRowIndex: exports.TITLE_ROW,
                    endRowIndex: exports.TITLE_ROW + 1,
                    startColumnIndex: mergeStartColumnIndex,
                    endColumnIndex: endColumnIndex,
                },
                mergeType: 'MERGE_ALL',
            },
        },
    ];
}
/** Builds the gray, bold, centered formatting applied to the column-header row. */
function buildHeaderRowRequest(sheetId, totalCols) {
    return {
        repeatCell: {
            range: { sheetId: sheetId, startRowIndex: exports.HEADERS_ROW, endRowIndex: exports.HEADERS_ROW + 1, startColumnIndex: 0, endColumnIndex: totalCols },
            cell: {
                userEnteredFormat: {
                    backgroundColor: exports.HEADER_BG,
                    textFormat: { bold: true },
                    horizontalAlignment: 'CENTER',
                },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
        },
    };
}
/** Builds one `updateDimensionProperties` request per column to set fixed pixel widths, starting at column 0. */
function buildColumnWidthRequests(sheetId, widthsByColumn) {
    return widthsByColumn.map(function (pixelSize, i) { return ({
        updateDimensionProperties: {
            range: { sheetId: sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
            properties: { pixelSize: pixelSize },
            fields: 'pixelSize',
        },
    }); });
}
/** Builds a request that freezes the title + header rows (and optionally a number of leading columns, e.g. Tag/Player). */
function buildFreezeRequest(sheetId, frozenRowCount, frozenColumnCount) {
    var gridProperties = { frozenRowCount: frozenRowCount };
    var fields = ['gridProperties.frozenRowCount'];
    if (frozenColumnCount !== undefined) {
        gridProperties.frozenColumnCount = frozenColumnCount;
        fields.push('gridProperties.frozenColumnCount');
    }
    return {
        updateSheetProperties: {
            properties: { sheetId: sheetId, gridProperties: gridProperties },
            fields: fields.join(', '),
        },
    };
}
/** Builds a request that applies boolean checkbox data validation to a column over a row range. */
function buildCheckboxValidationRequest(sheetId, column, startRowIndex, endRowIndex) {
    return {
        setDataValidation: {
            range: { sheetId: sheetId, startRowIndex: startRowIndex, endRowIndex: endRowIndex, startColumnIndex: column, endColumnIndex: column + 1 },
            rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true },
        },
    };
}
/** Builds a request that strips any data validation from a column over a row range (omitting `rule` clears it). */
function buildClearValidationRequest(sheetId, column, startRowIndex, endRowIndex) {
    return {
        setDataValidation: {
            range: { sheetId: sheetId, startRowIndex: startRowIndex, endRowIndex: endRowIndex, startColumnIndex: column, endColumnIndex: column + 1 },
        },
    };
}
/**
 * Builds requests to delete every existing conditional format rule on a sheet.
 * Indices are processed highest-to-lowest because deleting rule 0 shifts every
 * remaining rule's index down by one — deleting in reverse avoids skipping rules.
 */
function buildClearConditionalFormatRequests(sheetId, ruleCount) {
    var requests = [];
    for (var i = ruleCount - 1; i >= 0; i--) {
        requests.push({ deleteConditionalFormatRule: { sheetId: sheetId, index: i } });
    }
    return requests;
}
/**
 * Builds a request that locks a range to a fixed list of editors. Anyone not on
 * `editorEmails` gets a hard "you don't have permission" block on edit — used
 * for bot-managed columns (formulas, computed status, autofilled values) that
 * get overwritten on every refresh, so manual edits would otherwise silently
 * get lost. Always include the bot's service account email (so refreshes keep
 * working) plus any human admins who should be able to remove the protection
 * from the Sheets UI if the bot ever gets stuck.
 */
function buildProtectedRangeRequest(sheetId, range, description, editorEmails) {
    return {
        addProtectedRange: {
            protectedRange: {
                range: __assign({ sheetId: sheetId }, range),
                description: description,
                editors: { users: editorEmails },
            },
        },
    };
}
/** Builds requests to remove existing protected ranges by id, so warning ranges don't pile up duplicates on rebuild. */
function buildClearProtectedRangeRequests(protectedRangeIds) {
    return protectedRangeIds.map(function (protectedRangeId) { return ({ deleteProtectedRange: { protectedRangeId: protectedRangeId } }); });
}
