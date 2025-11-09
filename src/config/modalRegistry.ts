import { ModalSubmitInteraction, MessageFlags } from 'discord.js';
import { pool } from '../db.js';
import { buildFeatureEmbedAndComponents } from './serverSettingsBuilder.js';

// Define modal types
export type ModalType = 'text' | 'select';

// Define a modal setting structure
export interface ModalSetting {
  key: string;
  type: ModalType;
  tableName: string;
  featureName: string;
  processValue?: (value: string, interaction: ModalSubmitInteraction) => Promise<string | number | boolean>;
}

// Define a registry of all modals
export const ModalRegistry: Record<string, ModalSetting> = {
  // Ticket settings
  opened_identifier: {
    key: 'opened_identifier',
    type: 'text',
    tableName: 'ticket_settings',
    featureName: 'tickets',
  },
  closed_identifier: {
    key: 'closed_identifier',
    type: 'text',
    tableName: 'ticket_settings',
    featureName: 'tickets',
  },
  ticket_channel: {
    key: 'ticket_channel',
    type: 'text',
    tableName: 'ticket_settings',
    featureName: 'tickets',
    // Custom processing for ticket channel tags
    processValue: async (value) => {
      // Process player tags here (e.g., format, validate)
      return value.toLowerCase().replace(/\s+/g, ' ').trim();
    },
  },

  // Clan settings
  abbreviation: {
    key: 'abbreviation',
    type: 'text',
    tableName: 'clan_settings',
    featureName: 'clan_invites',
  },
  update_invite: {
    key: 'update_invite',
    type: 'text',
    tableName: 'clan_invite_settings',
    featureName: 'clan_invites',
  },
  clan_role_id: {
    key: 'clan_role_id',
    type: 'select', // Changed to select as it's a role select
    tableName: 'clan_settings',
    featureName: 'clan_invites',
  },

  // You can add more modal settings here
};

/**
 * Process a modal submission based on the registry
 */
export async function processModalSubmission(
  interaction: ModalSubmitInteraction,
  action: string,
  guildId: string
): Promise<boolean> {
  // Get modal setting from registry
  const modalSetting = ModalRegistry[action];
  if (!modalSetting) {
    return false; // Not found in registry
  }

  try {
    // Defer reply early to avoid timeout issues
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Get input value based on type
    let value: string | number | boolean = '';

    if (modalSetting.type === 'text') {
      // Text inputs are handled with getTextInputValue
      value = interaction.fields.getTextInputValue('input');

      // Apply custom processing if defined
      if (modalSetting.processValue) {
        value = await modalSetting.processValue(value, interaction);
      }
    } else if (modalSetting.type === 'select') {
      // For select components, we need to extract from the modal component data
      // Note: In Discord.js v14+, the actual handling of select menus in modals
      // is more complex and often requires different approaches

      // For now, fall back to getting input as text since true select menus in modals
      // require additional setup
      try {
        value = interaction.fields.getTextInputValue('input');
      } catch {
        // If there's an error getting the text input, use a default
        value = '';
      }

      // For a real implementation, you would need to use the appropriate API methods
      // based on the Discord.js version you're using
    }

    console.log(`Processing modal ${action}: ${modalSetting.key} = ${value} for guild ${guildId}`);

    // Update database with new value
    await pool.query(`UPDATE ${modalSetting.tableName} SET ${modalSetting.key} = $1 WHERE guild_id = $2`, [
      value,
      guildId,
    ]);

    // Update UI with new settings
    const { embed, components } = await buildFeatureEmbedAndComponents(
      guildId,
      interaction.user.id,
      modalSetting.featureName
    );

    // Update the original message
    if (interaction.message) {
      await interaction.message.edit({ embeds: [embed], components });
    }

    await interaction.followUp({
      content: `✅ ${modalSetting.key} updated successfully!`,
      flags: MessageFlags.Ephemeral,
    });

    return true;
  } catch (error) {
    console.error(`Error processing modal ${action}:`, error);

    // Check if we've already deferred or replied
    if (interaction.deferred && !interaction.replied) {
      await interaction.followUp({
        content: `❌ Error updating ${modalSetting.key}. Please try again.`,
        flags: MessageFlags.Ephemeral,
      });
    } else if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: `❌ Error updating ${modalSetting.key}. Please try again.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    return true; // Still return true since we handled the error
  }
}
