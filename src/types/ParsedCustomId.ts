import { CustomIdType } from '../utils/customId.js';

// types.ts
export interface ParsedCustomId {
  category: CustomIdType;
  action: string; // column name OR keyword
  guildId: string;
  cooldown: number;
  extra: string[];
  ownerId?: string;
}
