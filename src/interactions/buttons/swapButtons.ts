import EMBED_SERVER_FEATURE_CONFIG, {
  buildServerFeatureEmbedAndComponents,
} from '../../config/serverSettingsConfig.js';
import pool from '../../db.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { ButtonHandler } from '../handleButtonInteraction.js';
import { FeatureTable, getFeatureConfig } from './toggles.js';

const swapButton: ButtonHandler = {
  customId: 'swap',
  async execute(interaction, parsed) {
    const { guildId, extra } = parsed;
    const swapName = extra[0]; // db name for the column
    if (!interaction || !interaction?.guild) return;
    const allowed = await checkPerms(interaction, interaction.guild.id, 'button', 'higher', { hideNoPerms: true });
    if (!allowed) return;

    if (!(extra[1] in EMBED_SERVER_FEATURE_CONFIG)) {
      throw new Error(`Unsupported table: ${extra[1]}`);
    }

    const config = getFeatureConfig(extra[1] as FeatureTable);

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

      const { embed, components } = await buildServerFeatureEmbedAndComponents(
        guildId,
        interaction.user.id,
        config.displayName,
        config.description
      );
      await interaction.editReply({ embeds: [embed], components });
    }
  },
};

export default swapButton;
