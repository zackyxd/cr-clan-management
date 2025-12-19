/*
 * LEGACY FILE - COMMENTED OUT
 * This file has been replaced by the new feature-based architecture:
 * /src/features/clan-settings/interactions/router.ts
 * /src/features/clan-settings/service.ts
 *
 * Can be deleted once the new implementation is confirmed working.
 *
 * The entire file content is commented out below:
 */

/*
import { pool } from '../../db.js';
import { ButtonHandler } from '../../types/Handlers.js';
import {
  buildClanSettingsView,
  DEFAULT_CLAN_SETTINGS,
  getSelectMenuRowBuilder,
} from '../../config/clanSettingsConfig.js';
import { fetchClanName } from '../../services/clans.js';
import logger from '../../logger.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { repostInviteMessage, updateInviteMessage } from '../../commands/staff_commands/updateClanInvite.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { getClanSettingsData } from '../../cache/clanSettingsDataCache.js';

// When a settings for a specific clan is clicked in /clan-settings
// TOGGLES ONLY
const clanSettingsButton: ButtonHandler = {
  customId: 'clanSettings',
  async execute(interaction, parsed) {
    const { guildId, extra } = parsed;
    const cacheKey = extra[0]; // Cache key containing all the data we need
    // cachekey: cs_13
    // {
    //   data: {
    //     settingKey: 'invites_enabled',
    //     clantag: '#V2GQU',
    //     clanName: 'Clash of Clams',
    //     guildId: '1395124705639534614',
    //     ownerId: '272201620446511104'
    //   },
    //   expiry: 1760132800927
    // }
    // Retrieve the data from cache
    const settingsData = getClanSettingsData(cacheKey);
    // Just reply because if not in settingsData, means cache was lost.
    if (!settingsData) {
      await interaction.reply({
        content: 'Settings data not found. Please reselect the clan in the select menu, or run the command again.',
        ephemeral: true,
      });
      return;
    }
    const { settingKey: featureName, clantag, clanName } = settingsData;
    const allowed = await checkPerms(interaction, guildId, 'button', 'either', { hideNoPerms: true });
    if (!allowed) return; // no perms

    switch (featureName) {
      case 'family_clan': {
        const client = await pool.connect();

        try {
          await client.query('BEGIN');

          // 1️⃣ Fetch current settings
          const res = await client.query(`SELECT settings FROM clan_settings WHERE guild_id = $1 AND clantag = $2`, [
            guildId,
            clantag,
          ]);
          const currentSettings = { ...DEFAULT_CLAN_SETTINGS, ...(res.rows[0]?.settings ?? {}) };

          if (!currentSettings.family_clan) {
            const countRes = await client.query(
              `
              SELECT COUNT(*)::int FROM clan_settings 
              WHERE guild_id = $1 AND (settings->>'family_clan')::boolean = true
              `,
              [guildId]
            );
            const maxFamilyClansRes = await client.query(
              `
              SELECT max_family_clans FROM server_settings
              WHERE guild_id = $1
              `,
              [guildId]
            );
            if (countRes.rows[0].count >= maxFamilyClansRes.rows[0].max_family_clans) {
              const embed = new EmbedBuilder()
                .setDescription(
                  `This server already has the maximum **${maxFamilyClansRes.rows[0].max_family_clans}** family clans allowed.`
                )
                .setColor(EmbedColor.FAIL);
              await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
              return;
            }
          }

          // 2️⃣ Toggle the setting
          currentSettings.family_clan = !currentSettings.family_clan;

          // 3️⃣ Update clan_settings JSONB
          await client.query(`UPDATE clan_settings SET settings = $1 WHERE guild_id = $2 AND clantag = $3`, [
            currentSettings,
            guildId,
            clantag,
          ]);

          // 4️⃣ Update the clans table
          await client.query(`UPDATE clans SET family_clan = $1 WHERE guild_id = $2 AND clantag = $3`, [
            currentSettings.family_clan,
            guildId,
            clantag,
          ]);

          // ✅ Commit transaction
          await client.query('COMMIT');
        } catch (error) {
          // ❌ Rollback if anything fails
          await client.query('ROLLBACK');
          logger.error('Error toggling family_clan:', error);
          await interaction.followUp({ content: 'There was an error setting this clan as family clan.' });
        } finally {
          // Release client back to the pool
          client.release();
        }

        const clanName = await fetchClanName(guildId, clantag);

        // Find the select menu row in the current message
        const selectMenuRowBuilder = getSelectMenuRowBuilder(interaction.message.components);
        // Build new button rows
        const { embed, components: newButtonRows } = await buildClanSettingsView(
          guildId,
          clanName,
          clantag,
          interaction.user.id
        );

        // Replace all components with the new ones
        await interaction.editReply({
          embeds: [embed],
          components: selectMenuRowBuilder
            ? [...newButtonRows, selectMenuRowBuilder] // ✅ select menu goes last
            : newButtonRows,
        });
        break;
      }

      case 'nudge_enabled': {
        const res = await pool.query(`SELECT settings FROM clan_settings WHERE guild_id = $1 AND clantag = $2`, [
          guildId,
          clantag,
        ]);
        const currentSettings = { ...DEFAULT_CLAN_SETTINGS, ...(res.rows[0]?.settings ?? {}) };

        currentSettings.nudge_enabled = !currentSettings.nudge_enabled;

        await pool.query(`UPDATE clan_settings SET settings = $1 WHERE guild_id = $2 AND clantag = $3`, [
          currentSettings,
          guildId,
          clantag,
        ]);

        const clanName = await fetchClanName(guildId, clantag);

        // Find the select menu row in the current message
        const selectMenuRowBuilder = getSelectMenuRowBuilder(interaction.message.components);
        // Build new button rows
        const { embed, components: newButtonRows } = await buildClanSettingsView(
          guildId,
          clanName,
          clantag,
          interaction.user.id
        );

        // Replace all components with the new ones
        await interaction.editReply({
          embeds: [embed],
          components: selectMenuRowBuilder
            ? [...newButtonRows, selectMenuRowBuilder] // ✅ select menu goes last
            : newButtonRows,
        });

        break;
      }
      case 'invites_enabled': {
        const res = await pool.query(`SELECT settings FROM clan_settings WHERE guild_id = $1 AND clantag = $2`, [
          guildId,
          clantag,
        ]);
        const currentSettings = { ...DEFAULT_CLAN_SETTINGS, ...(res.rows[0]?.settings ?? {}) };

        currentSettings.invites_enabled = !currentSettings.invites_enabled;

        await pool.query(`UPDATE clan_settings SET settings = $1 WHERE guild_id = $2 AND clantag = $3`, [
          currentSettings,
          guildId,
          clantag,
        ]);

        const { rows } = await pool.query(
          `SELECT cis.channel_id,
            cis.message_id,
            cis.pin_message,
            (cs.settings ->> 'invites_enabled' = 'true') as invites_enabled
          FROM clan_invite_settings cis
          JOIN clan_settings cs
            ON cis.guild_id = cs.guild_id
            AND cs.clantag = $2   -- match clan
          WHERE cis.guild_id = $1
          LIMIT 1
          `,
          [guildId, clantag]
        );
        if (rows.length) {
          const { channel_id, message_id, pin_message } = rows[0];

          if (!channel_id || !message_id) {
            const embed = new EmbedBuilder()
              .setDescription(
                `Could not find the channel or message for the clan invites.\nPlease have an admin set it up using the \`/set-clan-invite-channel\` command.`
              )
              .setColor(EmbedColor.FAIL);
            await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
            return;
          }

          const { embeds, components } = await updateInviteMessage(pool, guildId);

          await repostInviteMessage({
            client: interaction.client,
            channelId: channel_id,
            messageId: message_id,
            embeds,
            components,
            pin: pin_message,
            pool: pool,
            guildId,
          });
        }

        const clanName = await fetchClanName(guildId, clantag);

        // Find the select menu row in the current message
        const selectMenuRowBuilder = getSelectMenuRowBuilder(interaction.message.components);
        // Build new button rows
        const { embed, components: newButtonRows } = await buildClanSettingsView(
          guildId,
          clanName,
          clantag,
          interaction.user.id
        );

        // Replace all components with the new ones
        await interaction.editReply({
          embeds: [embed],
          components: selectMenuRowBuilder
            ? [...newButtonRows, selectMenuRowBuilder] // ✅ select menu goes last
            : newButtonRows,
        });

        break;
      }
    }
  },
};

export default clanSettingsButton;
*/
