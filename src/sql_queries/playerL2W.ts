import format from 'pg-format';

export interface L2WPlayerRow {
  guild_id: string;
  playertag: string;
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
  playerName: string;
  status: 'l2w' | 'inactive' | 'removed';
  league: '5k' | '4k';
  notes?: string | null;
  durationDate?: string | null; // ISO date string or null = indefinite
  markedByDiscordId: string;
}

export function buildGetL2WPlayers(guildId: string, league: '5k' | '4k'): string {
  return format(
    `
    SELECT guild_id, playertag, player_name,
           l2w_status, l2w_league, l2w_notes, l2w_duration_date, l2w_marked_at, l2w_marked_by_discord_id
    FROM player_availability
    WHERE guild_id = %L AND l2w_status IS NOT NULL AND l2w_league = %L
    ORDER BY l2w_status, l2w_marked_at ASC
    `,
    guildId,
    league,
  );
}

export function buildGetL2WTags(guildId: string): string {
  return format(
    `
    SELECT playertag, player_name, l2w_status
    FROM player_availability
    WHERE guild_id = %L AND l2w_status IS NOT NULL
    `,
    guildId,
  );
}

export function buildUpsertL2WPlayer(guildId: string, data: UpsertL2WPlayerData): string {
  return format(
    `
    INSERT INTO player_availability
      (guild_id, playertag, player_name, l2w_status, l2w_league, l2w_notes, l2w_duration_date, l2w_marked_at, l2w_marked_by_discord_id)
    VALUES (%L, %L, %L, %L, %L, %L, %L, NOW(), %L)
    ON CONFLICT (guild_id, playertag) DO UPDATE SET
      player_name              = EXCLUDED.player_name,
      l2w_status               = EXCLUDED.l2w_status,
      l2w_league               = EXCLUDED.l2w_league,
      l2w_notes                = EXCLUDED.l2w_notes,
      l2w_duration_date        = EXCLUDED.l2w_duration_date,
      l2w_marked_at            = NOW(),
      l2w_marked_by_discord_id = EXCLUDED.l2w_marked_by_discord_id
    RETURNING *
    `,
    guildId,
    data.playertag,
    data.playerName,
    data.status,
    data.league,
    data.notes ?? null,
    data.durationDate ?? null,
    data.markedByDiscordId,
  );
}

export function buildUpdateL2WStatus(guildId: string, playertag: string, status: 'l2w' | 'inactive'): string {
  return format(
    `
    UPDATE player_availability
    SET l2w_status = %L, l2w_marked_at = NOW()
    WHERE guild_id = %L AND playertag = %L
    RETURNING *
    `,
    status,
    guildId,
    playertag,
  );
}

/**
 * Nulls out the L2W columns for the given player. If the row has no league override
 * either, the row is deleted entirely (no orphan rows).
 */
export function buildRemoveL2WPlayer(guildId: string, playertag: string): string {
  return format(
    `
    WITH cleared AS (
      UPDATE player_availability
      SET l2w_status = NULL, l2w_notes = NULL, l2w_duration_date = NULL,
          l2w_marked_at = NULL, l2w_marked_by_discord_id = NULL
      WHERE guild_id = %L AND playertag = %L
    )
    DELETE FROM player_availability
    WHERE guild_id = %L AND playertag = %L
      AND l2w_status IS NULL AND league_target IS NULL
    RETURNING playertag
    `,
    guildId,
    playertag,
    guildId,
    playertag,
  );
}

export function buildBatchRemoveL2WPlayers(guildId: string, tags: string[]): { text: string; values: unknown[] } {
  // Use a parameterized query so node-postgres serialises the JS array to a
  // proper PostgreSQL array literal — pg-format's %L does not handle arrays correctly.
  return {
    text: `
    WITH cleared AS (
      UPDATE player_availability
      SET l2w_status = NULL, l2w_notes = NULL, l2w_duration_date = NULL,
          l2w_marked_at = NULL, l2w_marked_by_discord_id = NULL
      WHERE guild_id = $1 AND playertag = ANY($2::varchar[])
    )
    DELETE FROM player_availability
    WHERE guild_id = $1 AND playertag = ANY($2::varchar[])
      AND l2w_status IS NULL AND league_target IS NULL
    RETURNING playertag
    `,
    values: [guildId, tags],
  };
}
