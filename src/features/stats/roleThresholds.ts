import { pool } from '../../db.js';

export type League = '5k' | '4k';
export type ThresholdKind = 'average' | 'colosseum';

export interface RoleTier {
  threshold: number;
  roleId: string;
}

/** Parses a registry setting key like `thresholds_average_5k` into its ladder identity. */
export function parseThresholdsSettingKey(settingKey: string): { kind: ThresholdKind; league: League } | null {
  const match = settingKey.match(/^thresholds_(average|colosseum)_(5k|4k)$/);
  if (!match) return null;
  return { kind: match[1] as ThresholdKind, league: match[2] as League };
}

/** Returns the tiers for one ladder, highest threshold first. */
export async function getRoleTiers(guildId: string, league: League, kind: ThresholdKind): Promise<RoleTier[]> {
  const res = await pool.query<{ threshold: number; role_id: string }>(
    `SELECT threshold, role_id
     FROM stats_role_thresholds
     WHERE guild_id = $1 AND league = $2 AND kind = $3
     ORDER BY threshold DESC`,
    [guildId, league, kind],
  );
  return res.rows.map((row) => ({ threshold: row.threshold, roleId: row.role_id }));
}

/** Returns every ladder for a guild in one query, each sorted highest threshold first. */
export async function getAllRoleTiers(guildId: string): Promise<Record<League, Record<ThresholdKind, RoleTier[]>>> {
  const res = await pool.query<{ league: League; kind: ThresholdKind; threshold: number; role_id: string }>(
    `SELECT league, kind, threshold, role_id
     FROM stats_role_thresholds
     WHERE guild_id = $1
     ORDER BY threshold DESC`,
    [guildId],
  );

  const tiers: Record<League, Record<ThresholdKind, RoleTier[]>> = {
    '5k': { average: [], colosseum: [] },
    '4k': { average: [], colosseum: [] },
  };
  for (const row of res.rows) {
    tiers[row.league][row.kind].push({ threshold: row.threshold, roleId: row.role_id });
  }
  return tiers;
}

/** Adds a tier, or repoints an existing threshold at a different role. */
export async function upsertRoleTier(
  guildId: string,
  league: League,
  kind: ThresholdKind,
  threshold: number,
  roleId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO stats_role_thresholds (guild_id, league, kind, threshold, role_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (guild_id, league, kind, threshold) DO UPDATE SET role_id = EXCLUDED.role_id`,
    [guildId, league, kind, threshold, roleId],
  );
}

/** Removes the tier at a threshold. Returns false if there was no tier to remove. */
export async function deleteRoleTier(
  guildId: string,
  league: League,
  kind: ThresholdKind,
  threshold: number,
): Promise<boolean> {
  const res = await pool.query(
    `DELETE FROM stats_role_thresholds
     WHERE guild_id = $1 AND league = $2 AND kind = $3 AND threshold = $4`,
    [guildId, league, kind, threshold],
  );
  return (res.rowCount ?? 0) > 0;
}
