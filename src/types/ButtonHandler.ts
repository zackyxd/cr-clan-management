import { ButtonInteraction } from 'discord.js';

// types.ts
export type ButtonHandler = {
  customId: string;
  execute: (interaction: ButtonInteraction, args: string[]) => Promise<void>;
};
