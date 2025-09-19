import format from 'pg-format';

export function buildInsertClanLinkQuery(guildId: string, clantag: string, clanName: string, trophies: number): string {
  return format(
    `
    WITH inserted_clan AS (
    INSERT INTO clans (guild_id, clantag, clan_name, clan_trophies)
    VALUES (%L, %L, %L, %L)
    ON CONFLICT (guild_id, clantag) DO NOTHING
    RETURNING clantag
    )
    SELECT
      (SELECT clantag FROM inserted_clan) AS inserted_clan;
    `,
    guildId,
    clantag,
    clanName,
    trophies
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
