import format from 'pg-format';

export function buildInsertClanLinkQuery(
  guildId: string,
  clantag: string,
  clanName: string,
  trophies: number,
  abbreviation: string
): string {
  return format(
    `
    INSERT INTO clans (guild_id, clantag, clan_name, clan_trophies, abbreviation)
    VALUES (%L, %L, %L, %L, %L)
    RETURNING clantag;
    `,
    guildId,
    clantag,
    clanName,
    trophies,
    abbreviation
  );
}

export function buildFindLinkedClan(guildId: string, clantag: string): string {
  return format(
    `
    SELECT clantag
    FROM clans
    WHERE guild_id = (%L) AND clantag = (%L)
    `,
    guildId,
    clantag
  );
}

/**
 * Get clans that are due for activity checking
 * Returns clans where clan_logs_enabled = true and haven't been checked recently
 */
export function buildGetClansForActivityCheck(limit: number = 20): string {
  return format(
    `
    SELECT 
      guild_id,
      clantag,
      clan_name,
      clan_role_id,
      clan_logs_channel_id,
      clan_logs_manage_roles,
      clan_logs_add_role,
      clan_logs_remove_role,
      last_activity_snapshot,
      last_activity_check_at
    FROM clans
    WHERE clan_logs_enabled = TRUE 
      AND clan_logs_channel_id IS NOT NULL
    ORDER BY 
      COALESCE(last_activity_check_at, '1970-01-01'::timestamptz) ASC
    LIMIT %L
    `,
    limit
  );
}

/**
 * Update the activity snapshot and check timestamp for a clan
 */
export function buildUpdateActivitySnapshot(
  guildId: string,
  clantag: string,
  snapshot: object,
  timestamp: Date
): string {
  return format(
    `
    UPDATE clans
    SET 
      last_activity_snapshot = %L::jsonb,
      last_activity_check_at = %L::timestamptz
    WHERE guild_id = %L AND clantag = %L
    `,
    JSON.stringify(snapshot),
    timestamp.toISOString(),
    guildId,
    clantag
  );
}
