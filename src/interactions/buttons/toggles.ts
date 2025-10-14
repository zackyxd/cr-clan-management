import { pool } from '../../db.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { ButtonHandler } from '../../types/Handlers.js';
import { TextChannel, NewsChannel } from 'discord.js';
import { updateInviteMessage, repostInviteMessage } from '../../commands/staff_commands/updateClanInvite.js';
import EMBED_SERVER_FEATURE_CONFIG, {
  buildServerFeatureEmbedAndComponents,
} from '../../config/serverSettingsConfig.js';

export type FeatureTable = keyof typeof EMBED_SERVER_FEATURE_CONFIG;
export function getFeatureConfig(tableName: FeatureTable) {
  return EMBED_SERVER_FEATURE_CONFIG[tableName];
}

const toggleButton: ButtonHandler = {
  customId: 'toggle',
  async execute(interaction, parsed) {
    const { guildId, extra } = parsed;
    const toggleName = extra[0]; // db name for the column
    console.log(toggleName);
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
      const { embed, components } = await buildServerFeatureEmbedAndComponents(
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
      const { embed, components } = await buildServerFeatureEmbedAndComponents(
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
        UPDATE link_settings
        SET ${toggleName} = NOT ${toggleName}
        WHERE guild_id = $1
        RETURNING ${toggleName}
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
      const { embed, components } = await buildServerFeatureEmbedAndComponents(
        guildId,
        interaction.user.id,
        config.displayName,
        config.description
      );
      await interaction.editReply({ embeds: [embed], components });
    }

    // Enable member channels feature
    if (toggleName === 'member_channels_feature') {
      const res = await pool.query(`SELECT is_enabled FROM guild_features WHERE guild_id = $1 AND feature_name = $2`, [
        guildId,
        'member_channels',
      ]);

      const isCurrentlyEnabled = res.rows[0]?.is_enabled ?? false;
      const newValue = !isCurrentlyEnabled;

      await pool.query(
        `INSERT INTO guild_features (guild_id, feature_name, is_enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, feature_name) DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
        [guildId, 'member_channels', newValue]
      );
      const { embed, components } = await buildServerFeatureEmbedAndComponents(
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

      const { embed, components } = await buildServerFeatureEmbedAndComponents(
        guildId,
        interaction.user.id,
        config.displayName,
        config.description
      );
      await interaction.editReply({ embeds: [embed], components });
    }

    // Show expired clan invites
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

      // update the message immediately
      const { embeds, components: components2 } = await updateInviteMessage(pool, guildId);

      const { rows } = await pool.query(
        `SELECT cis.channel_id,
          cis.message_id,
          cis.pin_message,
          (cs.settings ->> 'invites_enabled' = 'true') as invites_enabled
        FROM clan_invite_settings cis
        JOIN clan_settings cs
          ON cis.guild_id = cs.guild_id
        WHERE cis.guild_id = $1
        LIMIT 1
        `,
        [guildId]
      );
      console.log(rows);
      if (rows.length) {
        const { channel_id, message_id, pin_message } = rows[0];

        await repostInviteMessage({
          client: interaction.client,
          channelId: channel_id,
          messageId: message_id,
          embeds,
          components: components2,
          pin: pin_message,
          pool: pool, // your PG client for transaction
          guildId,
        });

        const { embed, components } = await buildServerFeatureEmbedAndComponents(
          guildId,
          interaction.user.id,
          config.displayName,
          config.description
        );
        await interaction.editReply({ embeds: [embed], components });
      }
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

      const { embed, components } = await buildServerFeatureEmbedAndComponents(
        guildId,
        interaction.user.id,
        config.displayName,
        config.description
      );
      await interaction.editReply({ embeds: [embed], components });
    }

    if (toggleName === 'pin_message') {
      const { rows } = await pool.query(
        `
        UPDATE clan_invite_settings
        SET ${toggleName} = NOT ${toggleName}
        WHERE guild_id = $1
        RETURNING ${toggleName}
        `,
        [guildId]
      );

      const isNowPinned = rows[0][toggleName]; // boolean after toggle

      if (isNowPinned) {
        const { rows: messageRows } = await pool.query(
          `
          SELECT channel_id, message_id
          FROM clan_invite_settings
          WHERE guild_id = $1
          LIMIT 1
          `,
          [guildId]
        );

        if (messageRows.length) {
          const { channel_id, message_id } = messageRows[0];

          try {
            const channel = await interaction.client.channels.fetch(channel_id);

            // Type guard for text-based channels
            if (
              channel &&
              channel.isTextBased() &&
              (channel instanceof TextChannel || channel instanceof NewsChannel)
            ) {
              const message = await channel.messages.fetch(message_id);
              await message.pin();

              // Optionally delete the system pin message
              const recent = await channel.messages.fetch({ limit: 5 });
              const systemMessage = recent.find((msg) => msg.type === 6);
              if (systemMessage) await systemMessage.delete().catch(console.error);
            }
          } catch (err) {
            console.error('Failed to pin message:', err);
          }
        }
      } else {
        const { rows: messageRows } = await pool.query(
          `
          SELECT channel_id, message_id
          FROM clan_invite_settings
          WHERE guild_id = $1
          LIMIT 1
          `,
          [guildId]
        );

        if (messageRows.length) {
          const { channel_id, message_id } = messageRows[0];

          try {
            const channel = await interaction.client.channels.fetch(channel_id);

            // Type guard for text-based channels
            if (
              channel &&
              channel.isTextBased() &&
              (channel instanceof TextChannel || channel instanceof NewsChannel)
            ) {
              const message = await channel.messages.fetch(message_id);
              await message.unpin();

              // Optionally delete the system pin message
              const recent = await channel.messages.fetch({ limit: 5 });
              const systemMessage = recent.find((msg) => msg.type === 6);
              if (systemMessage) await systemMessage.delete().catch(console.error);
            }
          } catch (err) {
            console.error('Failed to unpin message:', err);
          }
        }
      }

      const { embed, components } = await buildServerFeatureEmbedAndComponents(
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

export default toggleButton;
