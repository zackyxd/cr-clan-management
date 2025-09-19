import { MessageFlags } from 'discord.js';
import { ParsedCustomId } from '../types/ParsedCustomId.js';
import { InteractionTypes } from './checkPermissions.js';

const interactionCooldown = new Set<string>();

interface GuardOptions {
  cooldownMs?: number;
  ensureOwner?: boolean;
}

export async function ensureInteractionGuards(
  interaction: InteractionTypes,
  parsed: ParsedCustomId,
  { cooldownMs: cooldown = 0, ensureOwner = true }: GuardOptions = {}
): Promise<boolean> {
  const key = `${interaction.user.id}:${parsed.action}`;

  // Check owner
  if (ensureOwner && parsed.ownerId && parsed.ownerId !== interaction.user.id) {
    await interaction.reply({
      content: '❌ Please run your own command to use this.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  // Check cooldown
  if (interactionCooldown.has(key)) {
    await interaction.reply({
      content: '⏳ You are on cooldown for this action. Please wait a moment.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  if (cooldown > 0) {
    interactionCooldown.add(key);
    setTimeout(() => interactionCooldown.delete(key), cooldown);
  }

  return true;
}
