// types/handlers.ts
import { ButtonInteraction, ModalSubmitInteraction } from 'discord.js';
import { ParsedCustomId } from './ParsedCustomId.js';

export interface ButtonHandler {
  customId: string; // e.g. "settings", "modal"
  execute: (interaction: ButtonInteraction, parsed: ParsedCustomId) => Promise<void>;
}

export interface ModalHandler {
  customId: string; // e.g. "opened_identifier"
  execute: (interaction: ModalSubmitInteraction, parsed: ParsedCustomId) => Promise<void>;
}
