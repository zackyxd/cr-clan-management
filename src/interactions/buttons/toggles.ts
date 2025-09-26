import pool from '../../db.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { buildFeatureEmbedAndComponents } from './serverSettingsButton.js';
import { ButtonHandler } from '../../types/Handlers.js';
import EMBED_SERVER_FEATURE_CONFIG from '../../config/serverSettingEmbedBuilderConfig.js';

export type FeatureTable = keyof typeof EMBED_SERVER_FEATURE_CONFIG;
export function getFeatureConfig(tableName: FeatureTable) {
  return EMBED_SERVER_FEATURE_CONFIG[tableName];
}

const toggleButton: ButtonHandler = {
  customId: 'toggle',
  async execute(interaction, parsed) {
    const { guildId, extra } = parsed;
    const toggleName = extra[0]; // db name for the column
    if (!interaction || !interaction?.guild) return;
    const allowed = await checkPerms(interaction, interaction.guild.id, 'button', 'higher', { hideNoPerms: true });
    if (!allowed) return;

    if (!(extra[1] in EMBED_SERVER_FEATURE_CONFIG)) {
      throw new Error(`Unsupported table: ${extra[1]}`);
    }

    const config = getFeatureConfig(extra[1] as FeatureTable);

    // Enable linking feature
    if (toggleName === 'links_feature') {
      const res = await pool.query(`SELECT is_enabled FROM guild_features WHERE guild_id = $1 AND feature_name = $2`, [
        guildId,
        'links',
      ]);

      const isCurrentlyEnabled = res.rows[0]?.is_enabled ?? false;
      const newValue = !isCurrentlyEnabled;

      await pool.query(
        `INSERT INTO guild_features (guild_id, feature_name, is_enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, feature_name) DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
        [guildId, 'links', newValue]
      );
      const { embed, components } = await buildFeatureEmbedAndComponents(
        guildId,
        interaction.user.id,
        config.displayName,
        config.description
      );
      await interaction.editReply({ embeds: [embed], components });
    }

    // Enable clan invites feature
    if (toggleName === 'clan_invites_feature') {
      const res = await pool.query(`SELECT is_enabled FROM guild_features WHERE guild_id = $1 AND feature_name = $2`, [
        guildId,
        'clan_invites',
      ]);

      const isCurrentlyEnabled = res.rows[0]?.is_enabled ?? false;
      const newValue = !isCurrentlyEnabled;

      await pool.query(
        `INSERT INTO guild_features (guild_id, feature_name, is_enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, feature_name) DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
        [guildId, 'clan_invites', newValue]
      );
      const { embed, components } = await buildFeatureEmbedAndComponents(
        guildId,
        interaction.user.id,
        config.displayName,
        config.description
      );
      await interaction.editReply({ embeds: [embed], components });
    }

    // Toggle if linking should rename players
    if (toggleName === 'rename_players') {
      await pool.query(
        `
        UPDATE linking_settings
        SET ${toggleName} = NOT ${toggleName}
        WHERE guild_id = $1
        RETURNING ${toggleName}
        `,
        [guildId]
      );

      const { embed, components } = await buildFeatureEmbedAndComponents(
        guildId,
        interaction.user.id,
        config.displayName,
        config.description
      );
      await interaction.editReply({ embeds: [embed], components });
    }

    // Enable tickets feature
    if (toggleName === 'tickets_feature') {
      const res = await pool.query(`SELECT is_enabled FROM guild_features WHERE guild_id = $1 AND feature_name = $2`, [
        guildId,
        'tickets',
      ]);

      const isCurrentlyEnabled = res.rows[0]?.is_enabled ?? false;
      const newValue = !isCurrentlyEnabled;

      await pool.query(
        `INSERT INTO guild_features (guild_id, feature_name, is_enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, feature_name) DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
        [guildId, 'tickets', newValue]
      );
      const { embed, components } = await buildFeatureEmbedAndComponents(
        guildId,
        interaction.user.id,
        config.displayName,
        config.description
      );
      await interaction.editReply({ embeds: [embed], components });
    }

    // Toggle enabling appending name
    if (toggleName === 'allow_append') {
      await pool.query(
        `
        UPDATE ticket_settings
        SET ${toggleName} = NOT ${toggleName}
        WHERE guild_id = $1
        RETURNING ${toggleName}
        `,
        [guildId]
      );

      const { embed, components } = await buildFeatureEmbedAndComponents(
        guildId,
        interaction.user.id,
        config.displayName,
        config.description
      );
      await interaction.editReply({ embeds: [embed], components });
    }

    if (toggleName === 'pin_message') {
      await pool.query(
        `
        UPDATE clan_invite_settings
        SET ${toggleName} = NOT ${toggleName}
        WHERE guild_id = $1
        RETURNING ${toggleName}
        `,
        [guildId]
      );

      const { embed, components } = await buildFeatureEmbedAndComponents(
        guildId,
        interaction.user.id,
        config.displayName,
        config.description
      );
      await interaction.editReply({ embeds: [embed], components });
    }
    if (toggleName === 'show_inactive') {
      await pool.query(
        `
        UPDATE clan_invite_settings
        SET ${toggleName} = NOT ${toggleName}
        WHERE guild_id = $1
        RETURNING ${toggleName}
        `,
        [guildId]
      );

      const { embed, components } = await buildFeatureEmbedAndComponents(
        guildId,
        interaction.user.id,
        config.displayName,
        config.description
      );
      await interaction.editReply({ embeds: [embed], components });
    }

    if (toggleName === 'ping_expired') {
      await pool.query(
        `
        UPDATE clan_invite_settings
        SET ${toggleName} = NOT ${toggleName}
        WHERE guild_id = $1
        RETURNING ${toggleName}
        `,
        [guildId]
      );

      const { embed, components } = await buildFeatureEmbedAndComponents(
        guildId,
        interaction.user.id,
        config.displayName,
        config.description
      );
      await interaction.editReply({ embeds: [embed], components });
    }

    // Toggle enabling logs
    if (toggleName === 'send_logs') {
      const tableName = extra[1];
      await pool.query(
        `
        UPDATE ${tableName}
        SET ${toggleName} = NOT ${toggleName}
        WHERE guild_id = $1
        RETURNING ${toggleName}
        `,
        [guildId]
      );

      const { embed, components } = await buildFeatureEmbedAndComponents(
        guildId,
        interaction.user.id,
        config.displayName,
        config.description
      );
      await interaction.editReply({ embeds: [embed], components });
    }
  },
};

export default toggleButton;
