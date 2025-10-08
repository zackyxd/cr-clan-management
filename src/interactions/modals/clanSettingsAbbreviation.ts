import { EmbedBuilder, MessageFlags } from 'discord.js';
import { pool } from '../../db.js';
import { ModalHandler } from '../../types/Handlers.js';
import { fetchClanName } from '../../services/clans.js';
import logger from '../../logger.js';
import {
  buildClanSettingsView,
  DEFAULT_CLAN_SETTINGS,
  getSelectMenuRowBuilder,
} from '../../config/clanSettingsConfig.js';
import { EmbedColor } from '../../types/EmbedUtil.js';

const clanSettingsAbbreviation: ModalHandler = {
  customId: 'abbreviation',
  async execute(interaction, parsed) {
    const { guildId, action, extra } = parsed;
    const messageId = interaction.message?.id;
    if (!messageId) return;
    await interaction.deferReply({ ephemeral: true });
    const message = await interaction.channel?.messages.fetch(messageId);
    if (!message) return;
    // logic for abbreviation
    const newValue = interaction.fields.getTextInputValue('input').toLowerCase();
    // action = 'abbreviation'
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
      currentSettings.abbreviation = newValue;

      // 3️⃣ Update clan_settings JSONB
      await client.query(`UPDATE clan_settings SET settings = $1 WHERE guild_id = $2 AND clantag = $3`, [
        currentSettings,
        guildId,
        extra[0],
      ]);

      // 4️⃣ Update the clans table
      await client.query(`UPDATE clans SET ${action} = $1 WHERE guild_id = $2 AND clantag = $3`, [
        newValue,
        guildId,
        extra[0], // clantag
      ]);

      // ✅ Commit transaction
      await client.query('COMMIT');
    } catch (error) {
      // ❌ Rollback if anything fails
      await client.query('ROLLBACK');
      logger.warn('Error setting abbreviation clanSettingsAbbeviation.ts:', error);

      // Tell user about error and exit early so we don't continue
      const abbrevUsedRes = await pool.query(`SELECT clan_name FROM clans WHERE guild_id = $1 AND abbreviation = $2`, [
        guildId,
        newValue,
      ]);
      const clanName = abbrevUsedRes.rows[0].clan_name;
      const embed = new EmbedBuilder()
        .setDescription(`❌ \`${clanName}\` is already using this abbreviation.\nPlease choose another one.`)
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
      logger.error(`clanSettingsAbbreviation.ts: Didn't have interaction or interaction.message to edit`);
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

export default clanSettingsAbbreviation;
