import dotenv from 'dotenv';
dotenv.config({ path: `.env.${process.env.NODE_ENV}` });
import pool from './src/db';

const t0 = performance.now();
for (let i = 0; i < 10000; i++) {
  const result = await pool.query('SELECT lower_leader_role_id FROM server_settings');
  console.log(i);
}
const t1 = performance.now();
console.log('Call to function took ' + (t1 - t0) + ' milliseconds.');
