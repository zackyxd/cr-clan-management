// interactions/handleModalInteraction.ts
import { ModalSubmitInteraction, MessageFlags } from 'discord.js';
import { parseCustomId } from '../utils/customId.js';
import logger from '../logger.js';
import { ModalHandler } from '../types/Handlers.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { ensureInteractionGuards } from '../utils/ensureInteractionOwner.js';

const modals = new Map<string, ModalHandler>();

export function registerModal(handler: ModalHandler) {
  modals.set(handler.customId, handler);
}

export async function loadModals() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const modalDir = path.join(__dirname, 'modals');
  const files = await fs.readdir(modalDir);

  for (const file of files) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
    const modulePath = path.join(modalDir, file);
    const modal = (await import(modulePath)).default;

    if (modal?.customId && typeof modal.execute === 'function') {
      modals.set(modal.customId, modal);
    }
  }
}

export async function handleModalInteraction(interaction: ModalSubmitInteraction) {
  const parsed = parseCustomId(interaction.customId);
  const { action } = parsed;
  const handler = modals.get(action);
  if (!handler) {
    return interaction.reply({ content: 'Unknown modal.', flags: MessageFlags.Ephemeral });
  }

  const allowed = await ensureInteractionGuards(interaction, parsed, {
    ensureOwner: true,
  });

  if (!allowed) return;

  try {
    await handler.execute(interaction, parsed);
  } catch (error) {
    logger.error(`Error in modal handler [${interaction.customId}]`, error);
    interaction.followUp({ content: 'There was an error executing this modal.', flags: MessageFlags.Ephemeral });
  }
}
