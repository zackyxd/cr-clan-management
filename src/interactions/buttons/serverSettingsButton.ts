import { checkPerms } from '../../utils/checkPermissions.js';
import { buildSettingsView } from '../../commands/settings_commands/serverSettings.js';
import logger from '../../logger.js';
import { ButtonHandler } from '../../types/Handlers.js';

// Edit the below to when adding new global server settings
// Build the title/description of what a feature does.
// Get the server setting info to make the buttons / embed description
import EMBED_SERVER_FEATURE_CONFIG, {
  buildServerFeatureEmbedAndComponents,
} from '../../config/serverSettingsConfig.js';

// Handles all buttons on the initial /server-settings command
const settingsButton: ButtonHandler = {
  customId: 'settings',
  async execute(interaction, parsed) {
    // await interaction.deferUpdate();
    const { guildId, extra } = parsed;
    const featureName = extra[0]; // "links"

    // lower_leader_role_id is intentionally omitted
    if (!interaction || !interaction.guild) return;
    const allowed = await checkPerms(interaction, interaction.guild.id, 'button', 'higher', { hideNoPerms: true });
    if (!allowed) return; // no perms

    switch (featureName) {
      case 'links': {
        const { embed, components } = await buildServerFeatureEmbedAndComponents(
          guildId,
          interaction.user.id,
          EMBED_SERVER_FEATURE_CONFIG['link_settings'].displayName,
          EMBED_SERVER_FEATURE_CONFIG['link_settings'].description
        );
        await interaction.editReply({ embeds: [embed], components });
        break;
      }

      case 'tickets': {
        const { embed, components } = await buildServerFeatureEmbedAndComponents(
          guildId,
          interaction.user.id,
          EMBED_SERVER_FEATURE_CONFIG['ticket_settings'].displayName,
          EMBED_SERVER_FEATURE_CONFIG['ticket_settings'].description
        );
        await interaction.editReply({ embeds: [embed], components });
        break;
      }

      case 'clan_invites': {
        const { embed, components } = await buildServerFeatureEmbedAndComponents(
          guildId,
          interaction.user.id,
          EMBED_SERVER_FEATURE_CONFIG['clan_invite_settings'].displayName,
          EMBED_SERVER_FEATURE_CONFIG['clan_invite_settings'].description
        );
        await interaction.editReply({ embeds: [embed], components });
        break;
      }

      case 'return': {
        const { embed, components } = await buildSettingsView(guildId, interaction.user.id);
        try {
          interaction.editReply({
            embeds: [embed],
            components: components,
          });
        } catch (error) {
          logger.error(`Error showing server settings: ${error}`);
          interaction.editReply({ content: `Error showing settings. @Zacky to fix` });
          return;
        }
        break;
      }

      default: {
        break;
      }
    }
  },
};
export default settingsButton;
