import 'dotenv-flow/config';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../src/db.js';

const GUILD_ID = process.argv[2];
const CSV_PATH = process.argv[3];

if (!GUILD_ID || !CSV_PATH) {
  console.error('Usage: NODE_ENV=prod npx tsx scripts/import-linked-players.ts <guild_id> <path/to/file.csv>');
  process.exit(1);
}

const csv = fs.readFileSync(path.resolve(CSV_PATH), 'utf8');
const lines = csv.trim().split('\n').slice(1); // skip header

let inserted = 0;
let skipped = 0;

for (const line of lines) {
  const [tag, discordId] = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  if (!tag || !discordId) continue;

  const playertag = tag.startsWith('#') ? tag.toUpperCase() : '#' + tag.toUpperCase();

  try {
    await pool.query(
      `INSERT INTO users (guild_id, discord_id)
       VALUES ($1, $2)
       ON CONFLICT (guild_id, discord_id) DO NOTHING`,
      [GUILD_ID, discordId],
    );

    const res = await pool.query(
      `INSERT INTO user_playertags (guild_id, discord_id, playertag)
       VALUES ($1, $2, $3)
       ON CONFLICT (guild_id, playertag) DO NOTHING
       RETURNING playertag`,
      [GUILD_ID, discordId, playertag],
    );

    if (res.rowCount && res.rowCount > 0) {
      inserted++;
      console.log(`  ✓ ${playertag} → ${discordId}`);
    } else {
      skipped++;
      console.log(`  ~ skipped (already linked): ${playertag}`);
    }
  } catch (err) {
    console.error(`  ✗ error on ${playertag}:`, err);
  }
}

console.log(`\nDone: ${inserted} inserted, ${skipped} skipped.`);
await pool.end();
