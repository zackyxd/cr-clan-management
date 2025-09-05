import { EmbedBuilder } from 'discord.js';

export const playerEmbedCache = new Map<string, Map<string, EmbedBuilder>>();
