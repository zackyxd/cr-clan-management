import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';
import { CR_API, FetchError, normalizeTag } from '../api/CR_API.js';
import { PoolClient } from 'pg';
import { EmbedColor } from '../types/EmbedUtil.js';
import { buildInsertClanLinkQuery } from '../sql_queries/clans.js';
import { pool } from '../db.js';
import { isPgUniqueViolation } from '../utils/postgresError.js';

export async function linkClan(
  client: PoolClient,
  guildId: string,
  clantag: string,
  abbreviation: string
): Promise<{ embed: EmbedBuilder; components?: ActionRowBuilder<ButtonBuilder>[] }> {
  clantag = normalizeTag(clantag);
  const confirmClanExists = await CR_API.getClan(clantag);
  if ('error' in confirmClanExists) {
    const fetchError = confirmClanExists as FetchError;
    return {
      embed:
        fetchError.embed ?? new EmbedBuilder().setDescription(`Failed to fetch ${clantag}`).setColor(EmbedColor.FAIL),
    };
  }

  // Get max_clans from linking_settings to ensure they arent going to be over
  const maxClansRes = await client.query(
    `SELECT max_clans
    FROM server_settings
    WHERE guild_id = $1`,
    [guildId]
  );
  const maxLinks = maxClansRes.rows[0]?.max_clans ?? 15;

  // Check if clans is at the linked limit
  const clanLinkCountRes = await client.query(
    `SELECT COUNT(*)::int AS link_count
    FROM clans
    WHERE guild_id = $1`,
    [guildId]
  );
  const currentClanLinkCount = clanLinkCountRes.rows[0]?.link_count ?? 0;

  if (currentClanLinkCount >= maxLinks) {
    return {
      embed: new EmbedBuilder()
        .setDescription(`This server already has the maximum **${maxLinks}** linked clans allowed.`)
        .setColor(EmbedColor.FAIL),
    };
  }
  try {
    const insertClanSQL = buildInsertClanLinkQuery(
      guildId,
      clantag,
      confirmClanExists.name,
      confirmClanExists.clanWarTrophies,
      abbreviation
    );
    const res = await client.query(insertClanSQL);
    // Insert settings too
    await client.query(
      `
    INSERT INTO clan_settings (guild_id, clantag, settings)
    VALUES ($1, $2, '{}')
    ON CONFLICT (guild_id, clantag) DO NOTHING
    `,
      [guildId, clantag]
    );
    return {
      embed: new EmbedBuilder()
        .setDescription(`**${confirmClanExists.name}** was linked to the server!`)
        .setColor(EmbedColor.SUCCESS),
    };
  } catch (error: unknown) {
    if (isPgUniqueViolation(error)) {
      if (error.detail?.includes('(guild_id, clantag)')) {
        return {
          embed: new EmbedBuilder()
            .setDescription(`**${clantag}** is already linked in this server.`)
            .setColor(EmbedColor.WARNING),
        };
      }
      if (error.detail?.includes('abbreviation')) {
        return {
          embed: new EmbedBuilder()
            .setDescription(`The abbreviation \`${abbreviation}\` is already in use. Choose another one.`)
            .setColor(EmbedColor.WARNING),
        };
      }
    }
    throw error;
  }
}

export async function fetchClanName(guildId: string, clantag: string) {
  const res = await pool.query(
    `
    SELECT clan_name FROM clans WHERE guild_id = $1 AND clantag = $2
    `,
    [guildId, clantag]
  );
  return res.rows[0].clan_name ?? 'Failed to get clan name';
}
