import format from 'pg-format';

export interface LeagueAssignmentRow {
  guild_id: string;
  playertag: string;
  league_target: string;
  league_from: string;
  league_assigned_at: string;
  league_assigned_by_discord_id: string;
}

export function buildGetLeagueOverrides(guildId: string): string {
  return format(
    `
    SELECT playertag, league_target, league_from
    FROM player_availability
    WHERE guild_id = %L AND league_target IS NOT NULL
    `,
    guildId,
  );
}

export function buildUpsertLeagueAssignment(
  guildId: string,
  playertag: string,
  playerName: string,
  targetLeague: string,
  fromLeague: string | null,
  assignedByDiscordId: string,
): string {
  return format(
    `
    INSERT INTO player_availability
      (guild_id, playertag, player_name, league_target, league_from, league_assigned_at, league_assigned_by_discord_id)
    VALUES (%L, %L, %L, %L, %L, NOW(), %L)
    ON CONFLICT (guild_id, playertag) DO UPDATE SET
      player_name                  = EXCLUDED.player_name,
      league_target                = EXCLUDED.league_target,
      league_from                  = EXCLUDED.league_from,
      league_assigned_at           = NOW(),
      league_assigned_by_discord_id = EXCLUDED.league_assigned_by_discord_id
    RETURNING *
    `,
    guildId,
    playertag,
    playerName,
    targetLeague,
    fromLeague,
    assignedByDiscordId,
  );
}

/**
 * Nulls out the league override columns. If the row has no L2W status either,
 * the row is deleted entirely (no orphan rows).
 */
export function buildRemoveLeagueAssignment(guildId: string, playertag: string): string {
  return format(
    `
    WITH cleared AS (
      UPDATE player_availability
      SET league_target = NULL, league_from = NULL,
          league_assigned_at = NULL, league_assigned_by_discord_id = NULL
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
