import format from 'pg-format';

export function buildInsertClanLinkQuery(
  guildId: string,
  clantag: string,
  clanName: string,
  trophies: number,
  abbreviation: string,
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
    abbreviation,
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
    clantag,
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
      c.guild_id,
      c.clantag,
      c.clan_name,
      c.clan_role_id,
      c.clan_logs_channel_id,
      c.clan_logs_manage_roles,
      c.clan_logs_add_role,
      c.clan_logs_remove_role,
      c.last_activity_snapshot,
      c.last_activity_check_at,
      s.clan_roles_required_role_id
    FROM clans c
    LEFT JOIN server_settings s ON c.guild_id = s.guild_id
    WHERE c.clan_logs_enabled = TRUE 
      -- AND c.clan_logs_channel_id IS NOT NULL
    ORDER BY 
      COALESCE(c.last_activity_check_at, '1970-01-01'::timestamptz) ASC
    LIMIT %L
    `,
    limit,
  );
}

/**
 * Update the activity snapshot and check timestamp for a clan
 */
export function buildUpdateActivitySnapshot(
  guildId: string,
  clantag: string,
  snapshot: object,
  timestamp: Date,
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
    clantag,
  );
}

export function buildGetFamilyClans(guildId: string): string {
  return format(
    `
    SELECT clantag, clan_name, abbreviation, header_bg_hex, header_text_hex
    FROM clans
    WHERE guild_id = %L
      AND family_clan = true
    `,
    guildId,
  );
}
