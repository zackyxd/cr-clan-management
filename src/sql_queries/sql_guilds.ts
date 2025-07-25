import { Collection, Guild } from 'discord.js';
import pool from '../db.js';
import format from 'pg-format';
import logger from '../logger.js';
import { PoolClient } from 'pg';

const DEFAULT_FEATURES: Record<string, boolean> = {
  tickets: false,
};

/**
 * On entering a guild, takes the guild id and initialize to database.
 * @param guildId string of the guild id
 */
export async function initialize_guild(guildId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert into 'guilds' table
    const addGuildSql = format(
      `
    INSERT INTO guilds (guild_id, in_guild, left_at)
    VALUES (%L, true, NULL)
    ON CONFLICT (guild_id)
    DO UPDATE SET in_guild = true, left_at = NULL;
    `,
      guildId
    );
    await pool.query(addGuildSql);

    // Insert default features
    await insert_default_features(client, [guildId]);

    await client.query('COMMIT');
    logger.info(`Guild ${guildId} initialized with default features.`);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    logger.error(`Error initializing guild ${guildId}:`, error);
    return false;
  } finally {
    client.release();
  }

  logger.info(`Guild ${guildId} has added the bot!`);
  return true;
}

/**
 * Takes all the guilds and initializes them if bot was offline
 * @param guilds collection of guilds from client.guilds.cache
 */
export async function insert_guilds_on_startup(guilds: Collection<string, Guild>): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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
      const rows = newGuildIds.map((id) => [id]); // Convert each row to single-element array
      const addGuildsSql = format(
        `
          INSERT INTO guilds (guild_id)
          VALUES %L
          ON CONFLICT DO NOTHING;
          `,
        rows
      );
      await client.query(addGuildsSql);
      await insert_default_features(client, newGuildIds);

      logger.info(`Initialized ${newGuildIds.length} guilds to the database!`);
    } else {
      logger.info('No guilds added on startup.');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to insert guilds on startup:', error);
    return false; // Inserting guilds failed
  } finally {
    client.release();
  }
  return true; // Inserting guilds was a success
}

/**
 * Sets bot as not in the guild with a time so can delete data after x days
 * @param guildId: guild id to set bot not in guild and time of departure.
 */
export async function remove_guild(guildId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const removeGuildSql = format(
      `
    UPDATE guilds
    SET in_guild = false,
        left_at = NOW()
    WHERE guild_id = (%L)
    `,
      guildId
    );
    await client.query(removeGuildSql);
    logger.info(`Guild ${guildId} has been removed.`);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(`Failed to remove guild ${guildId}:`, error);
    return false; // Removing failed
  } finally {
    await client.release();
  }
  return true;
}

/**
 * Check all guilds on startup to see if any kicked the bot while it was down.
 * @param guildId: collection of guilds from client.guilds.cache
 */
export async function remove_guilds_on_startup(guilds: Collection<string, Guild>): Promise<void> {
  const currentGuildIds = [...guilds.keys()]; // All guilds bot is currently in

  // All guilds stored on db
  const existing = await pool.query(
    `
    SELECT guild_id FROM guilds WHERE in_guild = true;
    `
  );

  const dbGuildIds = existing.rows.map((row) => row.guild_id); // Array of guilds on db

  const missingGuildIds = dbGuildIds.filter((id) => !currentGuildIds.includes(id)); // Guilds bot is not in

  if (missingGuildIds.length > 0) {
    // 🔹 Mark those guilds as left: in_guild = false, left_at = now()
    await pool.query(
      `
      UPDATE guilds
      SET in_guild = false,
          left_at = NOW()
      WHERE guild_id = ANY($1);
      `,
      [missingGuildIds]
    );

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

  const rows = guildIds.flatMap((guildId) =>
    Object.entries(DEFAULT_FEATURES).map(([featureName, isEnabled]) => [guildId, featureName, isEnabled])
  );

  const insertSql = format(
    `
    INSERT INTO guild_features (guild_id, feature_name, is_enabled)
    VALUES %L
    ON CONFLICT (guild_id, feature_name) DO NOTHING;
    `,
    rows
  );

  await client.query(insertSql);
}
