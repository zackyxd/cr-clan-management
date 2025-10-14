import { pool } from '../../db.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { ButtonHandler } from '../handleButtonInteraction.js';
import { FeatureRegistry } from '../../config/featureRegistry.js';
import { buildFeatureEmbedAndComponents } from '../../config/serverSettingsBuilder.js';
import { getFeatureNameFromTable } from './toggles.js';

const swapButton: ButtonHandler = {
  customId: 'swap',
  async execute(interaction, parsed) {
    const { guildId, extra } = parsed;
    const swapName = extra[0]; // db name for the column
    if (!interaction || !interaction?.guild) return;
    const allowed = await checkPerms(interaction, interaction.guild.id, 'button', 'higher', { hideNoPerms: true });
    if (!allowed) return;

    const tableName = extra[1];

    // Check if the table is valid
    const feature = Object.values(FeatureRegistry).find((feature) => feature.tableName === tableName);
    if (!feature) {
      throw new Error(`Unsupported table: ${tableName}`);
    }

    if (swapName === 'delete_method') {
      await pool.query(
        `
        UPDATE clan_invite_settings
        SET delete_method = CASE
            WHEN delete_method = 'update' THEN 'delete'::delete_method_type
            ELSE 'update'::delete_method_type
          END
        WHERE guild_id = $1
        RETURNING delete_method
        `,
        [guildId]
      );

      const featureName = getFeatureNameFromTable(tableName);
      if (!featureName) {
        throw new Error(`Could not find feature for table: ${tableName}`);
      }

      const { embed, components } = await buildFeatureEmbedAndComponents(guildId, interaction.user.id, featureName);

      await interaction.editReply({ embeds: [embed], components });
    }
  },
};

export default swapButton;
