import { EmbedBuilder } from 'discord.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { ModalHandler } from '../../types/Handlers.js';
import pool from '../../db.js';
import { repostInviteMessage, updateInviteMessage } from '../../commands/staff_commands/updateClanInvite.js';
import { inviteQueue } from '../../queues/inviteQueue.js';
import { INVITE_EXPIRY_INTERVAL_SQL, INVITE_EXPIRY_MS, safeRemoveJob } from '../../config/clanInvitesConfig.js';

const updateInvite: ModalHandler = {
  customId: 'update_invite',
  async execute(interaction, parsed) {
    const { guildId } = parsed; // action will be "update_invite"
    const messageId = interaction.message?.id;
    if (!messageId) return;
    const message = await interaction.channel?.messages.fetch(messageId);
    if (!message) return;
    await interaction.deferReply({ ephemeral: true });

    const inviteLink = interaction.fields.getTextInputValue('input').toLowerCase();
    const regex = /\/invite\/.*tag=([^&]*)/;
    const regexLink =
      /https:\/\/link\.clashroyale\.com\/invite\/clan\/[a-z]{2}\?tag=[^&]*&token=[^&]*&platform=(android|ios)/;
    const match = inviteLink.match(regex); // gets the clantag
    const apiLink = inviteLink.match(regexLink); // gets the entire link
    if (match === null || match[1] === undefined || apiLink === null) {
      const embed = new EmbedBuilder()
        .setDescription(`Did not find a valid clan invite link.`)
        .setColor(EmbedColor.FAIL);
      await interaction.followUp({
        embeds: [embed],
      });
      return;
    }
    try {
      // 1️⃣ Fetch clan from DB
      const { rows } = await pool.query(
        `SELECT clan_name, clantag FROM clans WHERE guild_id = $1 AND clantag = $2 LIMIT 1`,
        [guildId, '#' + match[1].toUpperCase()] // match[1] is the clantag
      );

      if (!rows.length) {
        const embed = new EmbedBuilder()
          .setDescription(`❌ This clantag was not part of your linked clans. Add it using \`/add-clan\``)
          .setColor(EmbedColor.FAIL);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const clanName = rows[0].clan_name;
      const clantag = rows[0].clantag;

      // 2️⃣ Start transaction to update DB and queue
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Update DB
        // TODO change to 3 days
        const update = await client.query(
          `UPDATE clans
           SET active_clan_link = $1, active_clan_link_expiry_time = NOW() + ${INVITE_EXPIRY_INTERVAL_SQL}
           WHERE guild_id = $2 AND clantag = $3
           RETURNING active_clan_link_expiry_time`,
          [apiLink[0], guildId, clantag]
        );

        if (!update.rowCount) throw new Error('DB update failed');

        // Remove existing job if any
        const existing = await inviteQueue.getJob(`${guildId}_${clantag}`);
        await safeRemoveJob(existing ?? null);

        // Add job to queue
        await inviteQueue.add(
          'expireInvite',
          { guildId: guildId, clantag },
          {
            jobId: `${guildId}_${clantag}`,
            delay: INVITE_EXPIRY_MS, // TODO change to 3 days
            removeOnComplete: true,
            removeOnFail: true,
          }
        );

        // update the message immediately
        const { embeds, components } = await updateInviteMessage(client, guildId);

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
          LIMIT 1`,
          [guildId, clantag]
        );
        if (rows.length) {
          const { channel_id, message_id, pin_message } = rows[0];

          await repostInviteMessage({
            client: interaction.client,
            channelId: channel_id,
            messageId: message_id,
            embeds,
            components,
            pin: pin_message,
            pool: client, // your PG client for transaction
            guildId: guildId,
          });
        }

        await client.query('COMMIT');

        const expiresAt = update.rows[0].active_clan_link_expiry_time;
        const expiresAtUnix = Math.floor(new Date(expiresAt).getTime() / 1000);

        let embed: EmbedBuilder;
        if (rows[0].invites_enabled) {
          embed = new EmbedBuilder()
            .setDescription(
              `✅ Successfully added the new invite link for **${clanName}**.\nIt will expire <t:${expiresAtUnix}:R>`
            )
            .setColor(EmbedColor.SUCCESS);
        } else {
          embed = new EmbedBuilder()
            .setDescription(
              `❗ Successfully added the new invite link for **${clanName}**.\nIt will expire <t:${expiresAtUnix}:R>\nHowever, it will not show on the list as invites are disabled for this clan.`
            )
            .setColor(EmbedColor.WARNING);
        }
        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('Failed to update invite link + queue:', err);

        const embed = new EmbedBuilder()
          .setDescription(`❌ Failed to update invite link. Please try again.`)
          .setColor(EmbedColor.FAIL);
        await interaction.editReply({ embeds: [embed] });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Unexpected error in /update-clan-invite:', err);
      const embed = new EmbedBuilder()
        .setDescription(`❌ An unexpected error occurred. Contact @Zacky. ${err}`)
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
    }
  },
};

export default updateInvite;
