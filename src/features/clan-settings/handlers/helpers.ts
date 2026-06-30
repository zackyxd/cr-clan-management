/**
 * Shared helper functions for clan settings handlers
 */

import { ButtonInteraction } from 'discord.js';
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
    // Find the select menu row in the current message
    const selectMenuRowBuilder = getSelectMenuRowBuilder(interaction.message.components);

    // Build new button rows with updated settings - fetch fresh from DB
    const { embed, components: newButtonRows } = await buildClanSettingsView(
      guildId,
      clanName,
      clantag,
      interaction.user.id,
    );

    await interaction.editReply({
      embeds: [embed],
      components: selectMenuRowBuilder
        ? [...newButtonRows, selectMenuRowBuilder]
        : newButtonRows,
    });
  } catch (error) {
    logger.error('[updateClanSettingsView] Failed to update view:', error);
    throw error;
  }
}
