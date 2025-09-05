import { InteractionCategory } from '../utils/customId.js';

// types.ts
export interface ParsedCustomId {
  category: InteractionCategory;
  action: string; // column name OR keyword
  guildId: string;
  cooldown: number;
  extra: string[];
}
