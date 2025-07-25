import format from 'pg-format';

/**
 *
 * @param guildId Guild Id to insert into the DB
 * @returns pg-format string for the query.
 */
export function buildInsertGuildQuery(guildId: string): string {
  return format(
    `
    INSERT INTO guilds (guild_id, in_guild, left_at)
      VALUES (%L, true, NULL)
    ON CONFLICT (guild_id)
    DO UPDATE SET in_guild = true, left_at = NULL;
    `,
    guildId
  );
}

/**
 *
 * @param guildIds Guild Ids to insert into the DB
 * @returns pg-format string for the query
 */
export function buildInsertGuildsQuery(guildIds: string[]): string {
  const rows = guildIds.map((id) => [id, true, null]);
  return format(
    `
    INSERT INTO guilds (guild_id, in_guild, left_at)
    VALUES %L
    ON CONFLICT DO NOTHING;
    `,
    rows
  );
}

/**
 *
 * @param guildId Guild Id to remove from the db (set inactive)
 * @returns pg-format string for the query
 */
export function buildRemoveGuildQuery(guildId: string): string {
  return format(
    `
    UPDATE guilds
    SET in_guild = false,
        left_at = NOW()
    WHERE guild_id = (%L)
    `,
    guildId
  );
}

/**
 *
 * @param guildIds Guild Ids to remove from the db (set inactive)
 * @returns pg-format string for the query
 */
export function buildRemoveGuildsQuery(guildIds: string[]): string {
  return format(
    `
      UPDATE guilds
      SET in_guild = false,
          left_at = NOW()
      WHERE guild_id IN (%L);
      `,
    [guildIds]
  );
}

/**
 *
 * @param guildIds Array of guildIds stri
 * @param defaultFeatures
 * @returns
 */
export function buildInsertDefaultFeaturesQuery(guildIds: string[], defaultFeatures: Record<string, boolean>): string {
  const rows = guildIds.flatMap((guildId) =>
    Object.entries(defaultFeatures).map(([featureName, isEnabled]) => [guildId, featureName, isEnabled])
  );

  return format(
    `
    INSERT INTO guild_features (guild_id, feature_name, is_enabled)
    VALUES %L
    ON CONFLICT (guild_id, feature_name) DO NOTHING;
    `,
    rows
  );
}
