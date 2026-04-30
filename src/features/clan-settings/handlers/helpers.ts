/**
 * Shared helper functions for clan settings handlers
 */

import { ButtonInteraction, Message } from 'discord.js';
import { buildClanSettingsView, getSelectMenuRowBuilder } from '../config.js';
import logger from '../../../logger.js';

/**
 * Update the clan settings view with fresh data from database.
 * Preserves the clan select menu at the bottom if it exists.
 * 
 * @param interaction - The button interaction that triggered the update
 * @param guildId - Discord guild ID
 * @param clantag - Clan tag
 * @param clanName - Clan name for display
 */
export async function updateClanSettingsView(
  interaction: ButtonInteraction,
  guildId: string,
  clantag: string,
  clanName: string,
): Promise<void> {
  try {
    // Get the original message
    const message = interaction.message as Message;
    
    // Find the select menu row in the current message
    const selectMenuRowBuilder = getSelectMenuRowBuilder(message.components);

    // Build new button rows with updated settings - fetch fresh from DB
    const { embed, components: newButtonRows } = await buildClanSettingsView(
      guildId,
      clanName,
      clantag,
      interaction.user.id,
    );

    logger.debug(`[updateClanSettingsView] Updating message for ${clanName} (${clantag}) in guild ${guildId}`);

    // Update the original message (not a reply)
    await message.edit({
      embeds: [embed],
      components: selectMenuRowBuilder
        ? [...newButtonRows, selectMenuRowBuilder] // ✅ select menu goes last
        : newButtonRows,
    });
    
    logger.debug(`[updateClanSettingsView] Successfully updated message`);
  } catch (error) {
    logger.error('[updateClanSettingsView] Failed to update view:', error);
    throw error; // Re-throw so caller can handle
  }
}
