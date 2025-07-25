import { Events, Guild } from 'discord.js';
import { initialize_guild } from '../services/guilds.js';
import pool from '../db.js';
import logger from '../logger.js';
// import { isDev } from '../utils/env.js';

export const event = {
  name: Events.GuildCreate,
  async execute(guild: Guild) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await initialize_guild(client, guild.id);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Failed to initialize guild ${guild.id}:`, err);
    } finally {
      client.release();
    }
  },
};
