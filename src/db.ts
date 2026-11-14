import { Pool } from 'pg';
import logger from './logger.js';

export const pool = new Pool({
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  port: Number(process.env.PGPORT),

  max: 10, // max number of clients in pool
  idleTimeoutMillis: 30_000, // close idle clients after 30 seconds
  connectionTimeoutMillis: 2_000, // return error if connection takes 2s or longer
});

// Without this listener, an idle client dropped by Postgres (restart, pg_terminate_backend, etc.)
// emits an unhandled 'error' event, which becomes an uncaughtException and kills the bot.
pool.on('error', (error) => {
  logger.error('[DB] Idle client error (connection dropped):', error);
});

// export default pool;
