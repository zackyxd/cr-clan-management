import { Events, Guild } from 'discord.js';
import { initialize_guild } from '../sql_queries/sql_guilds.js';
// import { isDev } from '../utils/env.js';

export const event = {
  name: Events.GuildCreate,
  async execute(guild: Guild) {
    await initialize_guild(guild.id);
  },
};
