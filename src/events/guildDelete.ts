import { Events, Guild } from 'discord.js';
import { remove_guild } from '../utils/sql_queries/sql_guilds.js';
// import { isDev } from '../utils/env.js';

export const event = {
  name: Events.GuildDelete,
  async execute(guild: Guild) {
    await remove_guild(guild.id);
  },
};
