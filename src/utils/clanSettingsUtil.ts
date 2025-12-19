/*
 * LEGACY FILE - COMMENTED OUT
 * This utility was used by the old scattered clan settings handlers.
 * The new feature-based service handles database operations directly.
 *
 * Can be deleted once the new implementation is confirmed working.
 */

/*
import { PoolClient } from 'pg';

export async function updateClanSetting(
  client: PoolClient,
  guildId: string,
  clantag: string,
  key: string,
  value: number | string
) {
  const sql = `
  UPDATE clans
  SET settings = jsonb_set(
    settings,
    ARRAY[$1], -- path
    to_jsonb($2::text) -- value (cased to text to be generic)
  )
  WHERE guild_id = $3 AND clantag = $4
  RETURNING settings;
  `;

  const res = await client.query(sql, [key, JSON.stringify(value), guildId, clantag]);
  return res.rows[0]?.settings ?? null;
}
*/
