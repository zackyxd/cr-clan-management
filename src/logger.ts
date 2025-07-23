import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
const isTest = process.env.NODE_ENV === 'test';

const { combine, timestamp, printf, errors, splat, colorize } = format;

const consoleFormat = combine(
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  splat(),
  printf(({ timestamp, level, message, stack }) =>
    stack ? `${timestamp} ${level}: ${message}\n${stack}` : `${timestamp} ${level}: ${message}`
  )
);

const fileFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  splat(),
  printf(({ timestamp, level, message, stack }) =>
    stack ? `${timestamp} ${level}: ${message}\n${stack}` : `${timestamp} ${level}: ${message}`
  )
);

const dailyRotateTransport = new DailyRotateFile({
  filename: path.resolve('src/logs/application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true, // compress rotated files
  maxSize: '20m', // max size per file
  maxFiles: '14d', // keep logs for 14 days
  format: fileFormat,
});

const errorRotateTransport = new DailyRotateFile({
  filename: path.resolve('src/logs/error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '30d',
  level: 'error',
  format: fileFormat,
});

const logger = createLogger({
  level: isTest ? 'error' : process.env.LOG_LEVEL || 'info',
  transports: [
    new transports.Console({ format: consoleFormat }),
    dailyRotateTransport, // application logs rotate daily
    errorRotateTransport, // error logs rotate daily too
  ],
});

export default logger;
