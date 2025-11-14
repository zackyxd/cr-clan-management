import format from 'pg-format';
import { CR_API } from '../api/CR_API.js';

export function buildInsertPlayerLinkQuery(guildId: string, discordId: string, playertag: string): string {
  return format(
    `
    WITH inserted_user AS (
      INSERT INTO users (guild_id, discord_id)
      VALUES (%L, %L)
      ON CONFLICT (guild_id, discord_id) DO NOTHING
      RETURNING discord_id  
    ),
    inserted_tag AS (
      INSERT INTO user_playertags (guild_id, discord_id, playertag)
      VALUES (%L, %L, %L)
      ON CONFLICT (guild_id, playertag) DO NOTHING
      RETURNING playertag
    )
    SELECT 
      (SELECT discord_id FROM inserted_user) AS inserted_user,
      (SELECT playertag FROM inserted_tag) AS inserted_tag;
    `,
    guildId,
    discordId,
    guildId,
    discordId,
    playertag
  );
}

/**
 * Query to find the discord id for a user linked to a specific guild and playertag
 * @param guildId
 * @param discordId
 * @param playertag
 * @returns
 */
export function buildFindLinkedDiscordId(guildId: string, playertag: string): string {
  return format(
    `
    SELECT discord_id
    FROM user_playertags
    WHERE guild_id = (%L) AND playertag = (%L);
    `,
    guildId,
    playertag
  );
}

export function buildUnlinkPlayertag(guildId: string, playertag: string): string {
  return format(
    `
    DELETE FROM user_playertags
    WHERE guild_id = (%L) AND playertag = (%L)
    RETURNING discord_id
    `,
    guildId,
    playertag
  );
}

export function buildUpsertRelinkPlayertag(guildId: string, discordId: string, playertag: string): string {
  return format(
    `
    WITH inserted_user AS (
      INSERT INTO users (guild_id, discord_id)
      VALUES (%L, %L)
      ON CONFLICT (guild_id, discord_id) DO NOTHING
      RETURNING discord_id  
    ),
    inserted_tag AS (
      INSERT INTO user_playertags (guild_id, discord_id, playertag)
      VALUES (%L, %L, %L)
      ON CONFLICT (guild_id, playertag)
      DO UPDATE SET discord_id = EXCLUDED.discord_id
      RETURNING 
        playertag, -- always returned
        user_playertags.discord_id AS new_discord_id
    )
    SELECT 
      (SELECT discord_id FROM inserted_user) AS inserted_user,
      (SELECT playertag FROM inserted_tag) AS inserted_tag,
      (SELECT new_discord_id FROM inserted_Tag) AS new_discord_id
    `,
    guildId,
    discordId,
    guildId,
    discordId,
    playertag
  );
}

export function buildFindMember(guildId: string, playertag: string): string {
  return format(
    `
    SELECT discord_id 
    FROM user_playertags
    WHERE guild_id = (%L) AND playertag = (%L)
    `,
    guildId,
    playertag
  );
}

export function buildGetLinkedDiscordIds(guildId: string, playertags: string[]): string {
  const formattedTags = playertags.map((tag) => CR_API.normalizeTag(tag.toUpperCase()));
  return format(
    `
    SELECT discord_id, playertag
    FROM user_playertags
    WHERE guild_id = (%L) AND playertag IN (%L)
    `,
    guildId,
    formattedTags
  );
}

export function buildGetLinkedPlayertags(guildId: string, discordIds: string[]): string {
  const formattedIds = discordIds.map((id) => id.trim());
  return format(
    `
    SELECT discord_id, playertag
    FROM user_playertags
    WHERE guild_id = (%L) AND discord_id IN (%L)
    `,
    guildId,
    formattedIds
  );
}
