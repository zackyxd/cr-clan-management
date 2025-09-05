import { ButtonInteraction, MessageFlags } from 'discord.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import logger from '../logger.js';
import { parseCustomId } from '../utils/customId.js';
import { ParsedCustomId } from '../types/ParsedCustomId.js';

const buttons = new Map<string, ButtonHandler>();
const buttonCooldown = new Set<string>();

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
}

export interface ButtonHandler {
  customId: string;
  execute: (interaction: ButtonInteraction, parsed: ParsedCustomId) => Promise<void>;
}

export async function handleButtonInteraction(interaction: ButtonInteraction) {
  const parsed = parseCustomId(interaction.customId);
  console.log(parsed);
  const { category, action } = parsed;
  let { cooldown } = parsed;
  cooldown *= 1000;
  if (category !== 'button') {
    return interaction.reply({ content: 'Invalid interaction type for button.', flags: MessageFlags.Ephemeral });
  }
  const key = `${interaction.user.id}:${action}`; // or use parsed.action or parsed.extra too
  // console.log(buttons);
  const handler = buttons.get(action); // <-- use action ("relinkUser", "toggle", "settings")
  if (!handler) {
    return interaction.reply({ content: 'Unknown button.', flags: MessageFlags.Ephemeral });
  }

  if (cooldown > 0 && buttonCooldown.has(key)) {
    await interaction.reply({
      content: '⏳ Please wait a moment before trying again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (cooldown > 0) {
    buttonCooldown.add(key);
    setTimeout(() => buttonCooldown.delete(key), cooldown);
  }

  try {
    // pass the parsed object instead of args[]
    await handler.execute(interaction, parsed);
  } catch (error) {
    logger.error(`Error in button handler [${interaction.customId}]`, error);
    interaction.followUp({ content: 'There was an error executing this action.', flags: MessageFlags.Ephemeral });
  }
}
