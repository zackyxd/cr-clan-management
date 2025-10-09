import { EmbedBuilder, MessageFlags } from 'discord.js';
import {
  DEFAULT_CLAN_SETTINGS,
  getSelectMenuRowBuilder,
  buildClanSettingsView,
} from '../../config/clanSettingsConfig.js';
import { pool } from '../../db.js';
import logger from '../../logger.js';
import { fetchClanName } from '../../services/clans.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { ModalHandler } from '../../types/Handlers.js';

const clanSettingsClanRole: ModalHandler = {
  customId: 'clan_role_id',
  async execute(interaction, parsed) {
    const { guildId, extra } = parsed;
    const messageId = interaction.message?.id;
    if (!messageId) return;
    await interaction.deferReply({ ephemeral: true });
    const message = await interaction.channel?.messages.fetch(messageId);
    if (!message) return;
    // logic for abbreviation
    const roleSelected = interaction.fields.getSelectedRoles('input')?.first();
    if (!roleSelected || !roleSelected.id) {
      await interaction.followUp({ content: '❌ Please select a valid role.', flags: MessageFlags.Ephemeral });
      return;
    }
    // action = 'clan_role_id'
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1️⃣ Fetch current settings
      const res = await client.query(`SELECT settings FROM clan_settings WHERE guild_id = $1 AND clantag = $2`, [
        guildId,
        extra[0], // clantag
      ]);
      const currentSettings = { ...DEFAULT_CLAN_SETTINGS, ...(res.rows[0]?.settings ?? {}) };

      // 2️⃣ Toggle the setting
      currentSettings.clan_role_id = roleSelected.id;

      // 3️⃣ Update clan_settings JSONB
      await client.query(`UPDATE clan_settings SET settings = $1 WHERE guild_id = $2 AND clantag = $3`, [
        currentSettings,
        guildId,
        extra[0], // clantag
      ]);

      // ✅ Commit transaction
      await client.query('COMMIT');
    } catch (error) {
      // ❌ Rollback if anything fails
      await client.query('ROLLBACK');
      logger.warn('Error setting clan role id clanSettingsClanRole.ts:', error);

      const embed = new EmbedBuilder()
        .setDescription(`❌ \`${extra[1]}\` had an error setting clan role ${error}`)
        .setColor(EmbedColor.FAIL);
      await interaction.followUp({
        embeds: [embed],
      });

      return; // ⬅️ VERY IMPORTANT: stop execution here
    } finally {
      // Release client back to the pool
      client.release();
    }

    const clanName = await fetchClanName(guildId, extra[0]);

    // Find the select menu row in the current message
    if (!interaction || !interaction.message) {
      logger.error(`clanSettingsClanRole.ts: Didn't have interaction or interaction.message to edit`);
      return;
    }
    const selectMenuRowBuilder = getSelectMenuRowBuilder(interaction.message.components);
    // Build new button rows
    const { embed, components: newButtonRows } = await buildClanSettingsView(
      guildId,
      clanName,
      extra[0],
      interaction.user.id
    );

    if (interaction.message) {
      await interaction.message.edit({
        embeds: [embed],
        components: selectMenuRowBuilder
          ? [...newButtonRows, selectMenuRowBuilder] // ✅ select menu goes last
          : newButtonRows,
      });
    }
    // await interaction.editReply({
    //   embeds: [embed],
    //   components: selectMenuRowBuilder
    //     ? [...newButtonRows, selectMenuRowBuilder] // ✅ select menu goes last
    //     : newButtonRows,
    // });

    await interaction.followUp({ content: '✅ Updated successfully', flags: MessageFlags.Ephemeral });
  },
};

export default clanSettingsClanRole;
