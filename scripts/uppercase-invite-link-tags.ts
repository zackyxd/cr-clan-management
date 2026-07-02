import 'dotenv-flow/config';
import { pool } from '../src/db.js';

// One-off fix: existing clan_invite_links rows may have a lowercase `tag=` param
// in invite_link because parseInviteLink() used to lowercase the entire link
// before storing it. CR's invite endpoint rejects lowercase tags.
const linkRegex = /^(https:\/\/link\.clashroyale\.com\/invite\/clan\/[a-z]{2}\?tag=)([^&]*)(&token=[^&]*&platform=(?:android|ios))$/i;

const result = await pool.query<{ id: number; invite_link: string }>(
  `SELECT id, invite_link FROM clan_invite_links`,
);

let updated = 0;
let skipped = 0;

for (const row of result.rows) {
  const match = row.invite_link.match(linkRegex);
  if (!match) {
    console.warn(`Skipping id=${row.id}, link doesn't match expected format: ${row.invite_link}`);
    skipped++;
    continue;
  }

  const [, prefix, tag, suffix] = match;
  const upperTag = tag.toUpperCase();
  if (tag === upperTag) {
    skipped++;
    continue;
  }

  const newLink = `${prefix.toLowerCase()}${upperTag}${suffix.toLowerCase()}`;
  await pool.query(`UPDATE clan_invite_links SET invite_link = $1 WHERE id = $2`, [newLink, row.id]);
  console.log(`Updated id=${row.id}: ${row.invite_link} -> ${newLink}`);
  updated++;
}

console.log(`Done. Updated ${updated} row(s), skipped ${skipped} row(s).`);
await pool.end();
