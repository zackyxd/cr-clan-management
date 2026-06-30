"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commandLogger = void 0;
var winston_1 = require("winston");
var winston_daily_rotate_file_1 = require("winston-daily-rotate-file");
var path_1 = require("path");
var isTest = process.env.NODE_ENV === 'test';
var combine = winston_1.format.combine, timestamp = winston_1.format.timestamp, printf = winston_1.format.printf, errors = winston_1.format.errors, splat = winston_1.format.splat, colorize = winston_1.format.colorize;
var consoleFormat = combine(colorize(), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), splat(), printf(function (_a) {
    var timestamp = _a.timestamp, level = _a.level, message = _a.message, stack = _a.stack;
    return stack ? "".concat(timestamp, " ").concat(level, ": ").concat(message, "\n").concat(stack) : "".concat(timestamp, " ").concat(level, ": ").concat(message);
}));
var fileFormat = combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), splat(), printf(function (_a) {
    var timestamp = _a.timestamp, level = _a.level, message = _a.message, stack = _a.stack;
    return stack ? "".concat(timestamp, " ").concat(level, ": ").concat(message, "\n").concat(stack) : "".concat(timestamp, " ").concat(level, ": ").concat(message);
}));
var dailyRotateTransport = new winston_daily_rotate_file_1.default({
    filename: path_1.default.resolve('logs/application-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true, // compress rotated files
    maxSize: '20m', // max size per file
    maxFiles: '30d', // keep logs for 30 days
    format: fileFormat,
});
var errorRotateTransport = new winston_daily_rotate_file_1.default({
    filename: path_1.default.resolve('logs/error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    level: 'error',
    format: fileFormat,
});
var commandsRotateTransport = new winston_daily_rotate_file_1.default({
    filename: path_1.default.resolve('logs/commands-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    format: fileFormat,
});
var logger = (0, winston_1.createLogger)({
    level: isTest ? 'error' : process.env.LOG_LEVEL || 'info',
    transports: [
        new winston_1.transports.Console({ format: consoleFormat }),
        dailyRotateTransport,
        errorRotateTransport,
    ],
});
exports.commandLogger = (0, winston_1.createLogger)({
    level: 'info',
    transports: [commandsRotateTransport],
});
exports.default = logger;
