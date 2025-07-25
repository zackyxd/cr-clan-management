import { Events, Guild } from 'discord.js';
import { remove_guild } from '../sql_queries/sql_guilds.js';
import logger from '../logger.js';
import pool from '../db.js';
// import { isDev } from '../utils/env.js';

export const event = {
  name: Events.GuildDelete,
  async execute(guild: Guild) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await remove_guild(client, guild.id);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Failed to initialize guild ${guild.id}:`, err);
    } finally {
      client.release();
    }
  },
};
