import { Guild } from 'discord.js';

export const mockGuild = (id: string): Guild =>
  ({
    id,
  } as Guild);
