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
