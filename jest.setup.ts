import dotenv from 'dotenv';
import { execSync } from 'child_process';
import { pool } from './src/db.ts';
// Load .env.test before tests run
dotenv.config({ path: '.env.test' });

beforeAll(() => {
  execSync('npm run migrate:test:down-all', { stdio: ['ignore', 'ignore', 'ignore'] });
  execSync('npm run migrate:test:up', { stdio: ['ignore', 'ignore', 'ignore'] });
});

afterAll(async () => {
  await pool.end();
});
