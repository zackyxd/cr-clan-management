import { Pool } from 'pg';

const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT ? parseInt(process.env.PG_PORT, 10) : undefined,

  max: 10, // max number of clients in pool
  idleTimeoutMillis: 30_000, // close idle clients after 30 seconds
  connectionTimeoutMillis: 2_000, // return error if connection takes 2s or longer
});

export default pool;
