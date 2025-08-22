import { PoolClient } from 'pg';
import { CR_API, normalizeTag, isFetchError } from '../api/CR_API.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { buildFindLinkedDiscordId, buildInsertPlayerLinkQuery, buildUnlinkPlayertag } from '../sql_queries/users.js';
import { EmbedColor } from '../types/EmbedUtil.js';
import { formatPlayerData } from '../api/FORMAT_DATA.js';
import logger from '../logger.js';

export async function linkUser(
  client: PoolClient,
  guildId: string,
  originalDiscordId: string,
  playertag: string
): Promise<{ embed: EmbedBuilder; player_name?: string; components?: ActionRowBuilder[] }> {
  playertag = normalizeTag(playertag);
  const confirmPlayerExists = await CR_API.getPlayer(playertag);
  if (isFetchError(confirmPlayerExists)) {
    return { embed: confirmPlayerExists.embed };
  }

  // console.log(confirmPlayerExists);
  const insertUserSQL = buildInsertPlayerLinkQuery(guildId, originalDiscordId, playertag);
  const res = await client.query(insertUserSQL);
  const insertedTag = res.rows[0].inserted_tag; // 1 for inserted, null for not inserted
  // const wasUserInserted = Boolean(insertedUser);
  const wasPlayertagInserted = Boolean(insertedTag);
  // Both null means not inserted.
  if (wasPlayertagInserted === false) {
    const findLinkedDiscordIdQuery = buildFindLinkedDiscordId(guildId, playertag);
    const discordRes = await client.query(findLinkedDiscordIdQuery);
    const alreadyLinkedDiscordId = discordRes.rows[0].discord_id;
    if (alreadyLinkedDiscordId === originalDiscordId) {
      // Same user already linked.
      return {
        embed: new EmbedBuilder()
          .setDescription(
            `<@${alreadyLinkedDiscordId}> was already linked to this account \`(${playertag})\`. No Action Needed.`
          )
          .setColor(EmbedColor.WARNING),
      };
    } else if (wasPlayertagInserted === false) {
      // Different user linked.
      const cooldown = 5000; // ms
      const relink = new ButtonBuilder()
        .setCustomId(`relinkUser:${cooldown}:${guildId}:${originalDiscordId}:${playertag}`)
        .setLabel('Relink?')
        .setStyle(ButtonStyle.Secondary);
      const row = new ActionRowBuilder().addComponents(relink);
      return {
        embed: new EmbedBuilder()
          .setDescription(
            `**DID NOT LINK.**\n<@${alreadyLinkedDiscordId}> is already linked to this playertag \`(${playertag})\``
          )
          .setColor(EmbedColor.FAIL),
        components: [row],
      };
    }
  }
  const player_embed: EmbedBuilder | null = await formatPlayerData(confirmPlayerExists);
  if (!player_embed) {
    logger.error(
      `Issue linking ${playertag} to ${originalDiscordId} due to formatPlayerData not being valid. Should have been a new link. `
    );
    return {
      embed: new EmbedBuilder()
        .setDescription('**There was an issue with linking this player. May need to contact @Zacky')
        .setColor(EmbedColor.FAIL),
      components: [],
    };
  }
  if (wasPlayertagInserted) {
    player_embed?.setFooter({ text: `${playertag} | New Link!` });
  }
  return { embed: player_embed, player_name: confirmPlayerExists.name };
}

export async function unlinkUser(client: PoolClient, guildId: string, playertag: string): Promise<EmbedBuilder> {
  playertag = normalizeTag(playertag);

  const unlinkQuery = buildUnlinkPlayertag(guildId, playertag);
  const unlinkRes = await client.query(unlinkQuery);
  if (unlinkRes && unlinkRes.rowCount !== null && unlinkRes.rowCount > 0) {
    const confirmUnlink = await client.query(buildFindLinkedDiscordId(guildId, playertag));
    if (confirmUnlink && confirmUnlink.rows.length === 0) {
      return new EmbedBuilder()
        .setDescription(`**Successfully unlinked \`${playertag}\` from** <@${unlinkRes.rows[0].discord_id}>`)
        .setColor(EmbedColor.SUCCESS);
    } else {
      return new EmbedBuilder()
        .setDescription(`**Error with unlinking \`${playertag}\` from** <@${unlinkRes.rows[0].discord_id}>`)
        .setColor(EmbedColor.FAIL);
    }
  } else {
    return new EmbedBuilder()
      .setDescription(`**The playertag ${playertag} was not linked to anyone.**`)
      .setColor(EmbedColor.WARNING);
  }
}

// async function main() {
//   const client = await pool.connect();
//   const guildId = '555';
//   const discordId = '5318008';
//   const playertag = 'J20Y2QG0Y';
//   const test = await linkUser(client, guildId, discordId, playertag);
// }

// if (import.meta.url === `file://${process.argv[1]}`) {
//   main();
// }
