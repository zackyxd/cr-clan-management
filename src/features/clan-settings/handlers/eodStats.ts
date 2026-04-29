/**
 * End-of-Day Stats Settings Handler
 * 
 * Handles toggling automatic end-of-day race stats posting:
 * - Checks for staff channel configuration
 * - Updates database and sends audit logs
 * - Warns if staff channel not set
 */

import { ButtonInteraction } from 'discord.js';
import { clanSettingsService } from '../service.js';
import { updateClanSettingsView } from './helpers.js';
import type { ClanSettingsData } from '../types.js';
import logger from '../../../logger.js';

export class EodStatsHandler {
  /**
   * Handle EOD stats toggle button interaction
   * 
   * @param interaction - Button interaction from Discord
   * @param settingsData - Cached settings data (from cache key)
   */
  static async toggle(interaction: ButtonInteraction, settingsData: ClanSettingsData): Promise<void> {
    const { guildId, clantag, clanName } = settingsData;

    try {
      // Call service layer to toggle EOD stats
      const result = await clanSettingsService.toggleEodStatsEnabled(
        interaction,
        guildId,
        clantag,
        interaction.user.id,
      );

      // Handle failure
      if (!result.success) {
        await interaction.reply({
          content: result.error || 'Failed to toggle end-of-day stats setting',
          ephemeral: true,
        });
        return;
      }

      // Success - update the settings view to show new state
      await updateClanSettingsView(interaction, guildId, clantag, clanName);

      logger.info(
        `[EodStats] ${interaction.user.tag} toggled EOD stats for ${clanName} (${clantag}) in guild ${guildId}`,
      );
    } catch (error) {
      logger.error('[EodStats] Error toggling EOD stats:', error);
      
      await interaction.followUp({
        content: '❌ An unexpected error occurred while updating end-of-day stats setting.',
        ephemeral: true,
      });
    }
  }
}
