import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';
import { CR_API, FetchError, normalizeTag } from '../api/CR_API.js';
import { PoolClient } from 'pg';
import { EmbedColor } from '../types/EmbedUtil.js';
import { buildFindLinkedClan, buildInsertClanLinkQuery } from '../sql_queries/clans.js';
import pool from '../db.js';

export async function linkClan(
  client: PoolClient,
  guildId: string,
  clantag: string
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

  const insertClanSQL = buildInsertClanLinkQuery(
    guildId,
    clantag,
    confirmClanExists.name,
    confirmClanExists.clanWarTrophies
  );
  const res = await client.query(insertClanSQL);
  const insertedTag = res.rows[0].inserted_clan;
  const wasClanInserted = Boolean(insertedTag);
  // null means not inserted
  if (wasClanInserted === false) {
    const findLinkedClanQuery = buildFindLinkedClan(guildId, clantag);
    const alreadyLinkedRes = await client.query(findLinkedClanQuery);
    const alreadyLinkedClantag = await alreadyLinkedRes.rows[0].clantag;
    if (clantag === alreadyLinkedClantag) {
      // Already linked
      return {
        embed: new EmbedBuilder()
          .setDescription(`**${clantag}** was already linked to this server. No Action Needed.`)
          .setColor(EmbedColor.WARNING),
      };
    } else {
      return {
        embed: new EmbedBuilder()
          .setDescription(`Should not get this. Contact Zacky.\n-# Could not link clan, and didn't find it in db.`)
          .setColor(EmbedColor.FAIL),
      };
    }
  } else {
    // Is inserted, show settings for it.
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
