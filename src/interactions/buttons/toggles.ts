import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, GuildMember } from 'discord.js';
import pool from '../../db.js';
import { buildCheckHasRoleQuery, checkPermissions } from '../../utils/check_has_role.js';
import { buildFeatureEmbedAndComponents, LINK_FEATURES } from './serverSettings.js';

export default {
  customId: 'toggle',
  async execute(interaction: ButtonInteraction, args: string[]) {
    await interaction.deferUpdate();
    const [guildId, toggleName] = args;
    const member = (await interaction.guild?.members.fetch(interaction.user.id)) as GuildMember;
    const getRoles = await pool.query(buildCheckHasRoleQuery(guildId));
    const { lower_leader_role_id, higher_leader_role_id } = getRoles.rows[0];
    const requiredRoleIds = [higher_leader_role_id].filter(Boolean) as string[];
    const hasPerms = checkPermissions('button', member, requiredRoleIds);
    if (hasPerms && hasPerms.data) {
      return await interaction.followUp({ embeds: [hasPerms], ephemeral: true });
    }

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
  },
};
