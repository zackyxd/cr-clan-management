/**
 * Family Clan Settings Handler
 * 
 * Handles toggling a clan's family clan status with validation:
 * - Enforces max family clans limit from server settings
 * - Updates database and sends audit logs
 * - Refreshes the settings view
 */

import { ButtonInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { clanSettingsService } from '../service.js';
import { EmbedColor } from '../../../types/EmbedUtil.js';
import { updateClanSettingsView } from './helpers.js';
import type { ClanSettingsData } from '../types.js';
import logger from '../../../logger.js';

export class FamilyClanHandler {
  /**
   * Handle family clan toggle button interaction
   * 
   * @param interaction - Button interaction from Discord
   * @param settingsData - Cached settings data (from cache key)
   */
  static async toggle(interaction: ButtonInteraction, settingsData: ClanSettingsData): Promise<void> {
    const { guildId, clantag, clanName } = settingsData;

    try {
      // Call service layer to toggle family clan status
      const result = await clanSettingsService.toggleFamilyClan(
        interaction.client,
        guildId,
        clantag,
        interaction.user.id,
      );

      // Handle failure (e.g., max family clans reached)
      if (!result.success) {
        const embed = new EmbedBuilder()
          .setDescription(result.error || 'Failed to toggle family clan setting')
          .setColor(EmbedColor.FAIL);
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      // Success - update the settings view to show new state
      await updateClanSettingsView(interaction, guildId, clantag, clanName);

      logger.info(
        `[FamilyClan] ${interaction.user.tag} toggled family clan for ${clanName} (${clantag}) in guild ${guildId}`,
      );
    } catch (error) {
      logger.error('[FamilyClan] Error toggling family clan:', error);
      
      const embed = new EmbedBuilder()
        .setDescription('❌ An unexpected error occurred while updating family clan status.')
        .setColor(EmbedColor.FAIL);
      
      await interaction.followUp({ 
        embeds: [embed], 
        flags: MessageFlags.Ephemeral 
      });
    }
  }
}
