import { ButtonInteraction, MessageFlags } from 'discord.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import logger from '../logger.js';
import { parseCustomId } from '../utils/customId.js';
import { ParsedCustomId } from '../types/ParsedCustomId.js';
import { ensureInteractionGuards } from '../utils/ensureInteractionOwner.js';

const buttons = new Map<string, ButtonHandler>();

export async function loadButtons() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const buttonDir = path.join(__dirname, 'buttons');
  const files = await fs.readdir(buttonDir);

  for (const file of files) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;

    const modulePath = path.join(buttonDir, file);
    const button = (await import(modulePath)).default;

    if (button?.customId && typeof button.execute === 'function') {
      buttons.set(button.customId, button);
    }
  }
  console.log(buttons);
}

export interface ButtonHandler {
  customId: string;
  execute: (interaction: ButtonInteraction, parsed: ParsedCustomId) => Promise<void>;
}

export async function handleButtonInteraction(interaction: ButtonInteraction) {
  const parsed = parseCustomId(interaction.customId);
  const { category, action, cooldown } = parsed;
  if (category !== 'button') {
    return interaction.reply({ content: 'Invalid interaction type for button.', flags: MessageFlags.Ephemeral });
  }
  const handler = buttons.get(action); // <-- use action ("relinkUser", "toggle", "settings")
  if (!handler) {
    return interaction.reply({ content: 'Unknown button.', flags: MessageFlags.Ephemeral });
  }

  const allowed = await ensureInteractionGuards(interaction, parsed, {
    cooldownMs: cooldown * 1000,
    ensureOwner: true,
  });
  if (!allowed) return;

  try {
    // pass the parsed object instead of args[]
    await handler.execute(interaction, parsed);
  } catch (error) {
    logger.error(`Error in button handler [${interaction.customId}]`, error);
    interaction.followUp({ content: 'There was an error executing this action.', flags: MessageFlags.Ephemeral });
  }
}
