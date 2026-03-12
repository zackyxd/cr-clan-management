import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Message,
  NewsChannel,
  TextChannel,
} from 'discord.js';
import { Pool, PoolClient } from 'pg';
import { BOTCOLOR, EmbedColor } from '../../types/EmbedUtil.js';
import { makeCustomId } from '../../utils/customId.js';
import logger from '../../logger.js';
import { clanInviteService } from './service.js';
import { INVITE_EXPIRY_MS } from '../../config/clanInvitesConfig.js';
import { pool } from '../../db.js';

/**
 * Generate embeds and components for the master invite list message
 */
export async function updateInviteMessage(
  db: PoolClient | Pool,
  guildId: string,
): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] }> {
  // Get all active invites using the new service
  const activeInvites = await clanInviteService.getActiveInvitesForGuild(guildId);

  // Get settings for inactive display
  const settingsResult = await db.query(`SELECT show_inactive FROM clan_invite_settings WHERE guild_id = $1`, [
    guildId,
  ]);
  const showInactive = settingsResult.rows[0]?.show_inactive || false;

  // Separate active and expired clans
  const visibleClans = activeInvites.filter((invite) => invite.invites_enabled);
  interface ExpiredClan {
    clan_name: string;
    clan_trophies: number;
    role_id: string | null;
    invites_enabled: boolean;
  }
  const expiredClans: ExpiredClan[] = [];

  // If showing inactive, get clans with invites enabled but no active link
  if (showInactive) {
    const expiredResult = await db.query(
      `SELECT 
        c.clan_name,
        c.clan_trophies,
        c.clan_role_id AS role_id,
        c.invites_enabled
      FROM clans c
      LEFT JOIN clan_invites_links cil ON cil.guild_id = c.guild_id AND cil.clantag = c.clantag 
        AND cil.expires_at > NOW() AND cil.is_expired = FALSE
      WHERE c.guild_id = $1 
        AND c.invites_enabled = true
        AND cil.id IS NULL`,
      [guildId],
    );
    expiredClans.push(...expiredResult.rows);
    expiredClans.sort((a, b) => b.clan_trophies - a.clan_trophies);
  }

  const embeds: EmbedBuilder[] = [];
  const activeEmbed = new EmbedBuilder().setTitle('Active Clan Links').setColor(BOTCOLOR);
  if (visibleClans.length === 0) {
    activeEmbed.setDescription('No Active Links');
  } else {
    activeEmbed.setDescription(
      visibleClans
        .map((invite) => {
          const expiresAtUnix = Math.floor(new Date(invite.expires_at).getTime() / 1000);
          const name = invite.abbreviation ? invite.abbreviation.toUpperCase() : invite.clan_name;
          return `### [${name}](<${invite.invite_link}>): <t:${expiresAtUnix}:R>`;
        })
        .join('\n'),
    );
  }

  embeds.push(activeEmbed);
  if (showInactive) {
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
          .join('\n'),
      );
    }

    embeds.push(expiredEmbed);
  }

  // Button row
  const components = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Update Link')
        .setCustomId(makeCustomId('b', 'clanInviteRefresh', guildId, { cooldown: 5 }))
        .setStyle(ButtonStyle.Primary),
    ),
  ];
  return { embeds, components };
}

interface RepostInviteMessageOptions {
  client: Client;
  channelId: string;
  messageId?: string;
  embeds?: EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
  pin?: boolean;
  pool: PoolClient | Pool;
  guildId: string;
  messageIdColumn?: string;
}

/**
 * Update or create the master invite list message
 */
export async function repostInviteMessage(options: RepostInviteMessageOptions): Promise<Message> {
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
    } catch (err: unknown) {
      const error = err as { code?: number };
      if (error.code === 10008) {
        // message deleted
        logger.warn('Invite message was deleted');
        editableMessage = await channel.send({ embeds, components });
        // update DB with new message_id
        await pool.query(`UPDATE clan_invite_settings SET ${messageIdColumn} = $1 WHERE guild_id = $2`, [
          editableMessage.id,
          guildId,
        ]);
      } else {
        throw new Error('Invite message not accessible');
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

interface ProcessInviteLinkResult {
  success: boolean;
  embed: EmbedBuilder;
}

/**
 * Shared logic for processing invite link updates (used by command and modal)
 * Validates, creates link, updates master message
 */
export async function processInviteLinkUpdate(
  guildId: string,
  clantag: string,
  inviteLink: string,
  userId: string,
  client: Client,
): Promise<ProcessInviteLinkResult> {
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // Fetch clan info
    const { rows } = await dbClient.query(
      `SELECT clan_name, clantag FROM clans WHERE guild_id = $1 AND clantag = $2 LIMIT 1`,
      [guildId, clantag],
    );

    if (!rows.length) {
      await dbClient.query('ROLLBACK');
      return {
        success: false,
        embed: new EmbedBuilder()
          .setDescription(`❌ This clantag was not part of your linked clans. Add it using \`/add-clan\``)
          .setColor(EmbedColor.FAIL),
      };
    }

    const clanName = rows[0].clan_name;
    const resolvedClantag = rows[0].clantag;

    // Create new invite link
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);
    await clanInviteService.createInviteLink(client, guildId, resolvedClantag, inviteLink, userId, expiresAt, clanName);

    // Update master invite message
    const { embeds, components } = await updateInviteMessage(dbClient, guildId);

    const settingsResult = await dbClient.query(
      `SELECT cis.channel_id,
        cis.message_id,
        cis.pin_message,
        c.invites_enabled
      FROM clan_invite_settings cis
      JOIN clans c ON c.guild_id = cis.guild_id AND c.clantag = $2
      WHERE cis.guild_id = $1
      LIMIT 1`,
      [guildId, resolvedClantag],
    );

    if (settingsResult.rows.length) {
      const { channel_id, message_id, pin_message, invites_enabled } = settingsResult.rows[0];

      await repostInviteMessage({
        client,
        channelId: channel_id,
        messageId: message_id,
        embeds,
        components,
        pin: pin_message,
        pool: dbClient,
        guildId,
      });

      await dbClient.query('COMMIT');

      const expiresAtUnix = Math.floor(expiresAt.getTime() / 1000);
      if (invites_enabled) {
        return {
          success: true,
          embed: new EmbedBuilder()
            .setDescription(
              `✅ Successfully added the new invite link for **${clanName}**.\nIt will expire <t:${expiresAtUnix}:R>`,
            )
            .setColor(EmbedColor.SUCCESS),
        };
      } else {
        return {
          success: true,
          embed: new EmbedBuilder()
            .setDescription(
              `❗ Successfully added the new invite link for **${clanName}**.\nIt will expire <t:${expiresAtUnix}:R>\nHowever, it will not show on the list as invites are disabled for this clan.`,
            )
            .setColor(EmbedColor.WARNING),
        };
      }
    } else {
      await dbClient.query('ROLLBACK');
      return {
        success: false,
        embed: new EmbedBuilder()
          .setDescription(`❌ Invite settings not found. Please set up the invite channel first.`)
          .setColor(EmbedColor.FAIL),
      };
    }
  } catch (err) {
    await dbClient.query('ROLLBACK');
    logger.error('Failed to process invite link update:', err);
    return {
      success: false,
      embed: new EmbedBuilder()
        .setDescription(`❌ Failed to update invite link. Please try again.`)
        .setColor(EmbedColor.FAIL),
    };
  } finally {
    dbClient.release();
  }
}
