import { Collection, Guild } from 'discord.js';
import logger from '../logger.js';
import { PoolClient } from 'pg';
import {
  buildInsertDefaultFeaturesQuery,
  buildInsertGuildQuery,
  buildInsertGuildsQuery,
  buildRemoveGuildQuery,
  buildRemoveGuildsQuery,
} from '../sql_queries/guilds.js';

const DEFAULT_FEATURES: Record<string, boolean> = {
  tickets: false,
  links: true,
};

export async function sync_default_features(client: PoolClient): Promise<void> {
  // Get all existing guild-features pairs
  const res = await client.query(
    `
    SELECT guild_id, feature_name
    FROM guild_features`
  );

  const existing = new Set(res.rows.map((row) => `${row.guild_id}:${row.feature_name}`));
  // Get all guilds
  const guildsRes = await client.query(`SELECT guild_id from guilds`);
  const guildIds = guildsRes.rows.map((row) => row.guild_id);

  const inserts: { guildId: string; feature_name: string; enabled: boolean }[] = [];
  for (const guildId of guildIds) {
    for (const [feature_name, defaultEnabled] of Object.entries(DEFAULT_FEATURES)) {
      const key = `${guildId}:${feature_name}`;
      if (!existing.has(key)) {
        inserts.push({ guildId, feature_name, enabled: defaultEnabled });
      }
    }
  }

  if (inserts.length) {
    const values = inserts.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ');

    const query = `
      INSERT INTO guild_features (guild_id, feature_name, is_enabled)
      VALUES ${values}
    `;

    const params = inserts.flatMap((f) => [f.guildId, f.feature_name, f.enabled]);
    await client.query(query, params);
    console.log(`Synced ${inserts.length} new features to existing guilds.`);
  }

  await client.query(
    `
  DELETE FROM guild_features
  WHERE feature_name NOT IN (${Object.keys(DEFAULT_FEATURES)
    .map((_, i) => `$${i + 1}`)
    .join(', ')})
`,
    Object.keys(DEFAULT_FEATURES)
  );
}

/**
 * On entering a guild, takes the guild id and initialize to database.
 * @param guildId string of the guild id
 */
export async function initialize_guild(client: PoolClient, guildId: string): Promise<void> {
  // Insert into 'guilds' table
  const insertGuildSQL = buildInsertGuildQuery(guildId);
  await client.query(insertGuildSQL);

  // Insert default features
  await insert_default_features(client, [guildId]);

  logger.info(`Guild ${guildId} initialized with default features.`);
}

/**
 * Takes all the guilds and initializes them if bot was offline
 * @param guilds collection of guilds from client.guilds.cache
 */
export async function insert_guilds_on_startup(client: PoolClient, guilds: Collection<string, Guild>): Promise<void> {
  const allGuildIds = [...guilds.keys()]; // All guilds the bot is in ['123', '456', '789']

  // Get all guilds added to db
  const existing = await client.query(
    `
    SELECT guild_id FROM guilds WHERE guild_id = ANY($1);
    `,
    [allGuildIds]
  );

  const existingIds = new Set(existing.rows.map((row) => row.guild_id));
  const newGuildIds = allGuildIds.filter((id) => !existingIds.has(id));

  if (newGuildIds.length) {
    const insertGuildsSQL = buildInsertGuildsQuery(newGuildIds);
    await client.query(insertGuildsSQL);
    await insert_default_features(client, newGuildIds);
    logger.info(`Initialized ${newGuildIds.length} guilds to the database!`);
  } else {
    logger.info('No guilds added on startup.');
  }
}

/**
 * Sets bot as not in the guild with a time so can delete data after x days
 * @param guildId: guild id to set bot not in guild and time of departure.
 */
export async function remove_guild(client: PoolClient, guildId: string): Promise<void> {
  const removeGuildSql = buildRemoveGuildQuery(guildId);
  await client.query(removeGuildSql);
  logger.info(`Guild ${guildId} has been removed.`);
}

/**
 * Check all guilds on startup to see if any kicked the bot while it was down.
 * @param guildId: collection of guilds from client.guilds.cache
 */
export async function remove_guilds_on_startup(client: PoolClient, guilds: Collection<string, Guild>): Promise<void> {
  const currentGuildIds = [...guilds.keys()]; // All guilds bot is currently in

  // All guilds stored on db
  const existing = await client.query(
    `
    SELECT guild_id FROM guilds WHERE in_guild = true;
    `
  );

  const dbGuildIds = existing.rows.map((row) => row.guild_id); // Array of guilds on db

  const missingGuildIds = dbGuildIds.filter((id) => !currentGuildIds.includes(id)); // Guilds bot is not in

  if (missingGuildIds.length > 0) {
    // 🔹 Mark those guilds as left: in_guild = false, left_at = now()
    const removeGuildsSQL = buildRemoveGuildsQuery(missingGuildIds);
    await client.query(removeGuildsSQL);

    logger.info(`Marked ${missingGuildIds.length} guilds as left.`);
  } else {
    logger.info('No guilds marked as left.');
  }
}

/**
 * Inserts default features for a list of guild IDs.
 */
export async function insert_default_features(client: PoolClient, guildIds: string[]) {
  if (!guildIds.length) return;

  const insertSql = buildInsertDefaultFeaturesQuery(guildIds, DEFAULT_FEATURES);

  await client.query(insertSql);
}
