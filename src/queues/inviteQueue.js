"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inviteQueue = void 0;
var bullmq_1 = require("bullmq");
var ioredis_1 = require("ioredis");
var connection = new ioredis_1.Redis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
});
exports.inviteQueue = new bullmq_1.Queue('inviteQueue', { connection: connection });
