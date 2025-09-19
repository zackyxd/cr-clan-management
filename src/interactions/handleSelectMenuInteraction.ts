import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { MessageFlags, StringSelectMenuInteraction } from 'discord.js';
import { ParsedCustomId } from '../types/ParsedCustomId.js';
import { parseCustomId } from '../utils/customId.js';
import logger from '../logger.js';
import { ensureInteractionGuards } from '../utils/ensureInteractionOwner.js';

const selectMenus = new Map<string, SelectMenuHandler>();

export async function loadSelectMenus() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const menuDir = path.join(__dirname, 'selectMenus');
  const files = await fs.readdir(menuDir);

  for (const file of files) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
    const modulePath = path.join(menuDir, file);
    const menu = (await import(modulePath)).default;

    if (menu?.customId && typeof menu.execute === 'function') {
      selectMenus.set(menu.customId, menu);
    }
  }
}

export interface SelectMenuHandler {
  customId: string;
  execute: (interaction: StringSelectMenuInteraction, parsed: ParsedCustomId) => Promise<void>;
}

export async function handleSelectMenuInteraction(interaction: StringSelectMenuInteraction) {
  const parsed = parseCustomId(interaction.customId);
  const { category, action } = parsed;
  if (category !== 'select') {
    return interaction.reply({ content: 'Invalid interaction type for select menus.', flags: MessageFlags.Ephemeral });
  }

  const handler = selectMenus.get(action);
  if (!handler) {
    return interaction.reply({ content: 'Unknown Select Menu.', flags: MessageFlags.Ephemeral });
  }

  const allowed = await ensureInteractionGuards(interaction, parsed, {
    ensureOwner: true,
  });

  if (!allowed) return;

  try {
    // pass the parsed object instead of args[]
    await handler.execute(interaction, parsed);
  } catch (error) {
    logger.error(`Error in select menu handler [${interaction.customId}]`, error);
    interaction.followUp({ content: 'There was an error executing this action.', flags: MessageFlags.Ephemeral });
  }
}
