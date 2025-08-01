import { ButtonInteraction } from 'discord.js';
import path from 'path';
import fs from 'fs/promises';
import type { ButtonHandler } from '../types/ButtonHandler.js';
import logger from '../logger.js';
import { fileURLToPath } from 'url';

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

export async function handleButtonInteraction(interaction: ButtonInteraction) {
  const [action, ...args] = interaction.customId.split(':');
  const handler = buttons.get(action);

  if (!handler) {
    return interaction.reply({ content: 'Unknown button.', ephemeral: true });
  }
  console.log(buttonCooldown.has(interaction.user.id));
  if (buttonCooldown.has(interaction.user.id)) {
    await interaction.reply({
      content: '⏳ Please wait a moment before trying again.',
      ephemeral: true,
    });
    return;
  }
  buttonCooldown.add(interaction.user.id);
  setTimeout(() => buttonCooldown.delete(interaction.user.id), 5000); // 5 second cooldown
  console.log(buttonCooldown);
  try {
    await handler.execute(interaction, args);
  } catch (error) {
    logger.error(`Error in button handler [${interaction.customId}]`, error);
    interaction.reply({ content: 'There was an error executing this action.', ephemeral: true });
  }
}
