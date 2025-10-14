import { checkPerms } from '../../utils/checkPermissions.js';
import { buildSettingsView } from '../../commands/settings_commands/serverSettings.js';
import logger from '../../logger.js';
import { ButtonHandler } from '../../types/Handlers.js';

// Import from centralized feature registry and builder
import { FeatureRegistry } from '../../config/featureRegistry.js';
import { buildFeatureEmbedAndComponents } from '../../config/serverSettingsBuilder.js';

// Handles all buttons on the initial /server-settings command
const settingsButton: ButtonHandler = {
  customId: 'settings',
  async execute(interaction, parsed) {
    const { guildId, extra } = parsed;
    const featureName = extra[0]; // "links", "tickets", etc., or "return"

    // Check permissions - higher level roles only
    if (!interaction || !interaction?.guild) return;
    const allowed = await checkPerms(interaction, interaction.guild.id, 'button', 'higher', { hideNoPerms: true });
    if (!allowed) return;

    // Handle return to main settings view
    if (featureName === 'return') {
      try {
        const { embed, components } = await buildSettingsView(guildId, interaction.user.id);
        await interaction.editReply({
          embeds: [embed],
          components: components,
        });
      } catch (error) {
        logger.error(`Error showing server settings: ${error}`);
        await interaction.editReply({ content: `Error showing settings. @Zacky to fix` });
      }
      return;
    }

    // Handle feature specific settings view
    try {
      // If feature exists in registry, use the new system
      if (FeatureRegistry[featureName]) {
        const { embed, components } = await buildFeatureEmbedAndComponents(guildId, interaction.user.id, featureName);
        await interaction.editReply({ embeds: [embed], components });
      } else {
        // Fallback to legacy system if feature not in registry
        switch (featureName) {
          case 'links': {
            const { embed, components } = await buildFeatureEmbedAndComponents(
              guildId,
              interaction.user.id,
              'link_settings'
            );
            await interaction.editReply({ embeds: [embed], components });
            break;
          }

          case 'tickets': {
            const { embed, components } = await buildFeatureEmbedAndComponents(
              guildId,
              interaction.user.id,
              'ticket_settings'
            );
            await interaction.editReply({ embeds: [embed], components });
            break;
          }

          case 'clan_invites': {
            const { embed, components } = await buildFeatureEmbedAndComponents(
              guildId,
              interaction.user.id,
              'clan_invite_settings'
            );
            await interaction.editReply({ embeds: [embed], components });
            break;
          }

          case 'member_channels': {
            const { embed, components } = await buildFeatureEmbedAndComponents(
              guildId,
              interaction.user.id,
              'member_channel_settings'
            );
            await interaction.editReply({ embeds: [embed], components });
            break;
          }

          default: {
            logger.warn(`Unknown feature: ${featureName}`);
            await interaction.editReply({ content: `Unknown feature: ${featureName}` });
            break;
          }
        }
      }
    } catch (error) {
      logger.error(`Error handling settings button for ${featureName}:`, error);
      await interaction.editReply({
        content: `Error loading feature settings. Please try again or contact support.`,
      });
    }
  },
};

export default settingsButton;
