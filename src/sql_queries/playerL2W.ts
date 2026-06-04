import format from 'pg-format';

export interface L2WPlayerRow {
  guild_id: string;
  playertag: string;
  league: string;
  player_name: string;
  l2w_status: 'l2w' | 'inactive' | 'removed';
  l2w_league: '5k' | '4k' | null;
  l2w_notes: string | null;
  l2w_duration_date: string | null; // ISO date string or null = indefinite
  l2w_marked_at: string;
  l2w_marked_by_discord_id: string;
}

export interface UpsertL2WPlayerData {
  playertag: string;
  league: string;
  playerName: string;
  status: 'l2w' | 'inactive' | 'removed';
  notes?: string | null;
  durationDate?: string | null; // ISO date string or null = indefinite
  markedByDiscordId: string;
}

export function buildGetL2WPlayers(guildId: string, league: '5k' | '4k'): string {
  return format(
    `
    SELECT guild_id, playertag, league, player_name,
           l2w_status, l2w_league, l2w_notes, l2w_duration_date, l2w_marked_at
    FROM player_availability
    WHERE guild_id = %L AND league = %L AND l2w_status IS NOT NULL
    ORDER BY l2w_status, l2w_marked_at ASC
    `,
    guildId,
    league,
  );
}

export function buildGetL2WTags(guildId: string, league: string): string {
  return format(
    `
    SELECT playertag, player_name, l2w_status, l2w_notes
    FROM player_availability
    WHERE guild_id = %L AND league = %L AND l2w_status IS NOT NULL
    `,
    guildId,
    league,
  );
}

/**
 * Bulk-upserts l2w_notes for players from Available sheets.
 * Inserts missing player_availability rows, updates existing rows.
 */
export function buildBatchUpdateNotes(
  guildId: string,
  league: string,
  updates: { tag: string; playerName: string; notes: string | null }[],
): { text: string; values: unknown[] } | null {
  if (updates.length === 0) return null;
  return {
    text: `
    INSERT INTO player_availability (guild_id, playertag, league, player_name, l2w_notes)
    SELECT $1, v.playertag, $2, v.player_name, v.notes
    FROM (
      SELECT unnest($3::varchar[]) AS playertag,
             unnest($4::varchar[]) AS player_name,
             unnest($5::text[]) AS notes
    ) v
    ON CONFLICT (guild_id, playertag, league) DO UPDATE SET
      player_name = EXCLUDED.player_name,
      l2w_notes = EXCLUDED.l2w_notes
    `,
    values: [guildId, league, updates.map((u) => u.tag), updates.map((u) => u.playerName), updates.map((u) => u.notes)],
  };
}

export function buildUpsertL2WPlayer(guildId: string, data: UpsertL2WPlayerData): string {
  return format(
    `
    INSERT INTO player_availability
      (guild_id, playertag, league, player_name, l2w_status, l2w_league, l2w_notes, l2w_duration_date, l2w_marked_at)
    VALUES (%L, %L, %L, %L, %L, %L, %L, %L, NOW())
    ON CONFLICT (guild_id, playertag, league) DO UPDATE SET
      player_name              = EXCLUDED.player_name,
      l2w_status               = EXCLUDED.l2w_status,
      l2w_league               = EXCLUDED.l2w_league,
      l2w_notes                = EXCLUDED.l2w_notes,
      l2w_duration_date        = EXCLUDED.l2w_duration_date,
      l2w_marked_at            = NOW()
    RETURNING *
    `,
    guildId,
    data.playertag,
    data.league,
    data.playerName,
    data.status,
    data.league,
    data.notes ?? null,
    data.durationDate ?? null,
    data.markedByDiscordId,
  );
}

export function buildUpdateL2WStatus(
  guildId: string,
  playertag: string,
  league: '5k' | '4k',
  status: 'l2w' | 'inactive',
): string {
  return format(
    `
    UPDATE player_availability
    SET l2w_status = %L, l2w_marked_at = NOW()
    WHERE guild_id = %L AND playertag = %L AND league = %L
    RETURNING *
    `,
    status,
    guildId,
    playertag,
    league,
  );
}

/**
 * Nulls out the L2W columns for the given player. If the row has no league override
 * either, the row is deleted entirely (no orphan rows).
 */
export function buildRemoveL2WPlayer(guildId: string, playertag: string, league: '5k' | '4k'): string {
  return format(
    `
    UPDATE player_availability
    SET l2w_status = NULL, l2w_duration_date = NULL,
        l2w_marked_at = NULL
    WHERE guild_id = %L AND playertag = %L AND league = %L
    RETURNING playertag, league
    `,
    guildId,
    playertag,
    league,
  );
}

export function buildRemoveL2WPlayerAllLeagues(guildId: string, playertag: string): string {
  return format(
    `
    UPDATE player_availability
    SET l2w_status = NULL, l2w_duration_date = NULL,
        l2w_marked_at = NULL
    WHERE guild_id = %L AND playertag = %L
    RETURNING playertag, league
    `,
    guildId,
    playertag,
  );
}

export function buildBatchRemoveL2WPlayers(
  guildId: string,
  league: '5k' | '4k',
  tags: string[],
): { text: string; values: unknown[] } {
  // Use a parameterized query so node-postgres serialises the JS array to a
  // proper PostgreSQL array literal — pg-format's %L does not handle arrays correctly.
  return {
    text: `
    UPDATE player_availability
    SET l2w_status = NULL, l2w_duration_date = NULL,
        l2w_marked_at = NULL
    WHERE guild_id = $1 AND league = $2 AND playertag = ANY($3::varchar[])
    RETURNING playertag, league
    `,
    values: [guildId, league, tags],
  };
}
