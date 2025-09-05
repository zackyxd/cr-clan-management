import { GuildMember, MessageFlags } from 'discord.js';
import pool from '../../db.js';
import { buildCheckHasRoleQuery, checkPermissions } from '../../utils/check_has_role.js';
import { buildFeatureEmbedAndComponents } from './serverSettingsButton.js';
import { ButtonHandler } from '../../types/Handlers.js';

const toggleButton: ButtonHandler = {
  customId: 'toggle',
  async execute(interaction, parsed) {
    await interaction.deferUpdate();
    const { guildId, extra } = parsed;
    const toggleName = extra[0];
    const member = (await interaction.guild?.members.fetch(interaction.user.id)) as GuildMember;
    const getRoles = await pool.query(buildCheckHasRoleQuery(guildId));
    const { higher_leader_role_id } = getRoles.rows[0] ?? [];
    const requiredRoleIds = [higher_leader_role_id].filter(Boolean) as string[];
    const hasPerms = checkPermissions('button', member, requiredRoleIds);
    if (hasPerms && hasPerms.data) {
      await interaction.followUp({ embeds: [hasPerms], flags: MessageFlags.Ephemeral });
      return;
    }

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
        'links',
        'Links feature handles everything related to linking Discord accounts to their Clash Royale playertags.'
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
        'links',
        'Links feature handles everything related to linking Discord accounts to their Clash Royale playertags.'
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
        'tickets',
        'Ticket features handles everything related to tickets and ensuring you can handle new members.'
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
        'tickets',
        'Ticket features handles everything related to tickets and ensuring you can handle new members.'
      );
      await interaction.editReply({ embeds: [embed], components });
    }

    // Toggle enabling logs
    if (toggleName === 'send_logs') {
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
        'tickets',
        'Ticket features handles everything related to tickets and ensuring you can handle new members.'
      );
      await interaction.editReply({ embeds: [embed], components });
    }
  },
};

export default toggleButton;
