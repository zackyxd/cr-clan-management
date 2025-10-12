import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Message,
  MessageFlags,
  NewsChannel,
  SlashCommandBuilder,
  TextChannel,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { checkFeature } from '../../utils/checkFeatureEnabled.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { pool } from '../../db.js';
import { normalizeTag } from '../../api/CR_API.js';
import { BOTCOLOR, EmbedColor } from '../../types/EmbedUtil.js';
import { Pool, PoolClient } from 'pg';
import { makeCustomId } from '../../utils/customId.js';
import logger from '../../logger.js';
import { INVITE_EXPIRY_INTERVAL_SQL, INVITE_EXPIRY_MS, safeRemoveJob } from '../../config/clanInvitesConfig.js';
import { inviteQueue } from '../../queues/queueManager.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('update-clan-invite')
    .setDescription('Update clan invites with new links')
    .addStringOption((option) =>
      option.setName('invite-link').setDescription('Copy and paste the clan invite here').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const featureCheck = await checkFeature(interaction, guild.id, 'clan_invites');
    if (!featureCheck) {
      return;
    }

    const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;

    const inviteLink = interaction.options.getString('invite-link')?.trim();
    if (!inviteLink) return;
    const regex = /\/invite\/.*tag=([^&]*)/;
    const regexLink =
      /https:\/\/link\.clashroyale\.com\/invite\/clan\/[a-z]{2}\?tag=[^&]*&token=[^&]*&platform=(android|iOS)/;
    const match = inviteLink.match(regex); // gets the clantag
    const apiLink = inviteLink.match(regexLink); // gets the entire link
    if (match === null || match[1] === undefined || apiLink === null) {
      console.log('not valid invite updateclaninvie.ts');
      return;
    }
    // match
    //  [
    // '/invite/clan/du?tag=V2GQU',
    // 'V2GQU',
    // index: 36,
    // input: '[V2GQU](https://link.clashroyale.com/invite/clan/du?tag=V2GQU&token=6666666&platform=iOS)',
    // groups: undefined
    //  ]

    // apiLink
    //   [
    // 'https://link.clashroyale.com/invite/clan/du?tag=V2GQU&token=6666666&platform=iOS',
    // 'iOS',
    // index: 8,
    // input: '[V2GQU](https://link.clashroyale.com/invite/clan/du?tag=V2GQU&token=6666666&platform=iOS)',
    // groups: undefined
    //   ]

    const givenClantag = normalizeTag(match[1]);

    try {
      // 1️⃣ Fetch clan from DB
      const { rows } = await pool.query(
        `SELECT clan_name, clantag FROM clans WHERE guild_id = $1 AND clantag = $2 LIMIT 1`,
        [guild.id, givenClantag]
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
        const update = await client.query(
          `UPDATE clans
       SET active_clan_link = $1, active_clan_link_expiry_time = NOW() + ${INVITE_EXPIRY_INTERVAL_SQL}
       WHERE guild_id = $2 AND clantag = $3
       RETURNING active_clan_link_expiry_time`,
          [apiLink[0], guild.id, clantag]
        );

        if (!update.rowCount) throw new Error('DB update failed');

        // Remove existing job if any
        const existing = await inviteQueue.getJob(`${guild.id}_${clantag}`);
        await safeRemoveJob(existing ?? null);

        // Add job to queue
        await inviteQueue.add(
          'expireInvite',
          { guildId: guild.id, clantag },
          {
            jobId: `${guild.id}_${clantag}`,
            delay: INVITE_EXPIRY_MS,
            removeOnComplete: true,
            removeOnFail: true,
          }
        );

        // update the message immediately
        const { embeds, components } = await updateInviteMessage(client, guild.id);

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
          [guild.id, clantag]
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
            guildId: guild.id,
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

export async function updateInviteMessage(
  db: PoolClient | Pool,
  guildId: string
): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] }> {
  const { rows } = await db.query(
    `
    SELECT 
      c.clan_name,
      c.clan_trophies,
      c.abbreviation, 
      -- c.show_clan_link,
      c.active_clan_link, 
      c.active_clan_link_expiry_time,
      cis.channel_id, 
      cis.message_id, 
      cis.show_inactive, 
      cis.ping_expired,
      cs.settings ->> 'clan_role_id' AS role_id,
      cs.settings ->> 'invites_enabled' = 'true' as invites_enabled
    FROM clans c
    JOIN clan_invite_settings cis
      ON c.guild_id = cis.guild_id
    JOIN clan_settings cs
      ON c.guild_id = cs.guild_id
      AND cs.clantag = c.clantag
    WHERE c.guild_id = $1
    `,
    [guildId]
  );
  // if (!rows.length) return 'a';
  const now = new Date();

  // Get only links that want to show
  const visibleClans = rows.filter((row) => {
    if (!row.invites_enabled || !row.active_clan_link || !row.active_clan_link_expiry_time) {
      return false;
    }

    const expiresAt = new Date(row.active_clan_link_expiry_time);
    return expiresAt.getTime() > now.getTime();
  });

  visibleClans.sort((a, b) => b.clan_trophies - a.clan_trophies);

  const expiredClans = rows.filter(
    (row) =>
      row.invites_enabled &&
      (!row.active_clan_link || !row.active_clan_link_expiry_time || new Date(row.active_clan_link_expiry_time) <= now)
  );

  expiredClans.sort((a, b) => b.clan_trophies - a.clan_trophies);
  const embeds: EmbedBuilder[] = [];
  const activeEmbed = new EmbedBuilder().setTitle('Active Clan Links').setColor(BOTCOLOR);
  if (visibleClans.length === 0) {
    activeEmbed.setDescription('No Active Links');
  } else {
    activeEmbed.setDescription(
      visibleClans
        .map((clan) => {
          const expiresAtUnix = Math.floor(new Date(clan.active_clan_link_expiry_time).getTime() / 1000);
          const name = clan.abbreviation ? clan.abbreviation.toUpperCase() : clan.clan_name;
          return `### [${name}](<${clan.active_clan_link}>): <t:${expiresAtUnix}:R>`;
        })
        .join('\n')
    );
  }

  embeds.push(activeEmbed);
  if (rows[0].show_inactive) {
    const expiredEmbed = new EmbedBuilder().setTitle('Inactive Clans Links').setColor('Red');

    if (expiredClans.length === 0) {
      expiredEmbed.setDescription('No Inactive Links');
    } else {
      expiredEmbed.setDescription(
        expiredClans
          .map((clan) => {
            return clan.role_id
              ? `<@&${clan.role_id}>, your link has expired.`
              : `${clan.clan_name}, your link has expired.`;
          })
          .join('\n')
      );
    }

    embeds.push(expiredEmbed);
  }

  // Button row
  const components = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Update Link')
        .setCustomId(makeCustomId('button', 'open_modal', guildId, { cooldown: 1, extra: ['update_invite'] }))
        .setStyle(ButtonStyle.Primary)
    ),
  ];
  return { embeds, components };
}

interface InviteMessageOptions {
  client: Client;
  channelId: string;
  messageId?: string; // existing message, optional
  embeds?: EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
  pin?: boolean;
  pool: PoolClient | Pool; // for DB updates
  guildId: string;
  messageIdColumn?: string; // column name for updating message_id in DB
}
export async function repostInviteMessage(options: InviteMessageOptions): Promise<Message> {
  const {
    client,
    channelId,
    messageId,
    embeds,
    components,
    pin,
    pool,
    guildId,
    messageIdColumn = 'message_id',
  } = options;

  // Fetch channel
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
    throw new Error('Channel is not text-based or cannot be accessed.');
  }

  let editableMessage: Message;

  if (messageId) {
    try {
      // try editing existing message
      editableMessage = await channel.messages.edit(messageId, { content: null, embeds, components });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.code === 10008) {
        // message deleted
        logger.warn('Invite message was deleted');
        editableMessage = await channel.send({ embeds, components });
        // update DB with new message_id
        await pool.query(`UPDATE clan_invite_settings SET ${messageIdColumn} = $1 WHERE guild_id = $2`, [
          editableMessage.id,
          guildId,
        ]);
      } else {
        throw err('invite message not accessible');
      }
    }
  } else {
    // no existing message, send new one
    editableMessage = await channel.send({ embeds, components });
    // update DB with new message_id
    await pool.query(`UPDATE clan_invite_settings SET ${messageIdColumn} = $1 WHERE guild_id = $2`, [
      editableMessage.id,
      guildId,
    ]);
  }

  // optionally pin the message
  if (pin) {
    try {
      await editableMessage.pin();

      // delete the system pin message
      const recent = await channel.messages.fetch({ limit: 5 });
      const systemMessage = recent.find((msg) => msg.type === 6);
      if (systemMessage) await systemMessage.delete().catch(console.error);
    } catch (err) {
      console.warn('Failed to pin or remove system message:', err);
    }
  }
  return editableMessage;
}

export default command;
