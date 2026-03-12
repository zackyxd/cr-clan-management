import { Client, EmbedBuilder, NewsChannel, TextChannel } from 'discord.js';
import { pool } from '../../db.js';
import logger from '../../logger.js';
import { clanInviteService } from './service.js';
import { INVITE_EXPIRY_MS } from '../../config/clanInvitesConfig.js';
import { updateInviteMessage, repostInviteMessage } from './messageManager.js';
import { EmbedColor } from '../../types/EmbedUtil.js';

interface ExpiredInvite {
  id: number;
  guild_id: string;
  clantag: string;
  clan_name: string;
  invite_link: string;
  expires_at: Date;
  messages: Array<{
    message_id: string;
    channel_id: string;
    source_type: string;
    sent_by_id: string;
  }>;
}

export class InviteScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL = 10 * 1000; // Check every 10 seconds

  constructor(private client: Client) {}

  start() {
    if (this.intervalId) return;
    logger.info('Starting invite scheduler');
    this.intervalId = setInterval(() => this.checkExpiredInvites(), this.CHECK_INTERVAL);

    // Run on startup
    this.checkExpiredInvites();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Stopped invite scheduler');
    }
  }

  private async checkExpiredInvites() {
    try {
      const result = await pool.query<ExpiredInvite>(`
        SELECT 
          cil.id,
          cil.guild_id,
          cil.clantag,
          c.clan_name,
          cil.invite_link,
          cil.expires_at,
          array_agg(
            json_build_object(
            'message_id', ilm.message_id,
            'channel_id', ilm.channel_id,
            'source_type', ilm.source_type,
            'sent_by_id', ilm.sent_by_id
            )
          ) AS messages
        FROM clan_invites_links cil
        LEFT JOIN invite_link_messages ilm on ilm.invite_link_id = cil.id
        LEFT JOIN clans c ON c.guild_id = cil.guild_id AND c.clantag = cil.clantag
        WHERE cil.expires_at <= NOW() AND cil.is_expired = FALSE
        GROUP BY cil.id, cil.guild_id, cil.clantag, c.clan_name, cil.invite_link, cil.expires_at
      `);

      if (result.rows.length > 0) {
        logger.info(`Found ${result.rows.length} expired invite(s) to process`);
      }

      for (const expiredInvite of result.rows) {
        await this.handleExpiredInvite(expiredInvite);
      }
    } catch (error) {
      logger.error('Error checking expired invites:', error);
    }
  }

  private async handleExpiredInvite(expiredInvite: ExpiredInvite) {
    const { id, guild_id, clantag, clan_name, messages } = expiredInvite;

    try {
      // 1. Mark invite as expired
      await clanInviteService.markInviteAsExpired(this.client, id, guild_id, clantag, clan_name);
      logger.info(`Marked invite ${id} as expired for clan ${clantag} in guild ${guild_id}`);

      // 2. Get clan and settings info
      const settingsResult = await pool.query(
        `SELECT 
          cis.channel_id,
          cis.message_id,
          cis.ping_expired,
          c.clan_name,
          c.clan_role_id
        FROM clan_invite_settings cis
        JOIN clans c ON c.guild_id = cis.guild_id AND c.clantag = $2
        WHERE cis.guild_id = $1`,
        [guild_id, clantag],
      );

      const settings = settingsResult.rows[0];
      const shouldPing = settings?.ping_expired && settings?.clan_role_id;
      const clanRoleId = settings?.clan_role_id;
      const clanName = settings?.clan_name || clantag;
      const masterChannelId = settings?.channel_id;
      const masterMessageId = settings?.message_id;

      // 3. Update the master list message to show expired invite moved to inactive section
      if (masterChannelId && masterMessageId) {
        try {
          const { embeds, components } = await updateInviteMessage(pool, guild_id);
          await repostInviteMessage({
            client: this.client,
            channelId: masterChannelId,
            messageId: masterMessageId,
            embeds,
            components,
            pin: false, // Don't re-pin
            pool,
            guildId: guild_id,
          });
          logger.info(`Updated master invite list in guild ${guild_id}`);
        } catch (err) {
          logger.error(`Failed to update master invite list:`, err);
        }
      }

      // 4. Update tracked messages (from /send-invite or other sources)
      // Filter out null entries from array_agg when there are no tracked messages
      const validMessages = messages?.filter((msg) => msg.message_id && msg.channel_id) || [];

      if (validMessages.length > 0) {
        for (const msg of validMessages) {
          try {
            // Fetch channel
            const channel = await this.client.channels.fetch(msg.channel_id);
            if (!channel?.isTextBased() || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
              logger.warn(`Channel ${msg.channel_id} is not text-based or cannot be accessed`);
              continue;
            }

            // For tracked messages, mark them as expired
            try {
              const message = await channel.messages.fetch(msg.message_id);
              if (message.embeds.length > 0) {
                const embed = EmbedBuilder.from(message.embeds[0]);
                embed.setDescription(`❌ Link for **${clanName}** has expired.`);
                embed.setColor(EmbedColor.FAIL);
                await message.edit({ embeds: [embed], components: [] });
                logger.info(`Marked message ${msg.message_id} as expired in channel ${msg.channel_id}`);
              }
            } catch (editErr: unknown) {
              const error = editErr as { code?: number };
              if (error.code === 10008) {
                logger.warn(`Message ${msg.message_id} was already deleted`);
              } else {
                throw editErr;
              }
            }
          } catch (err) {
            logger.error(`Failed to update tracked message ${msg.message_id}:`, err);
          }
        }
      }

      // 5. Send ping notification if enabled (and delete it)
      if (shouldPing && masterChannelId) {
        try {
          const channel = await this.client.channels.fetch(masterChannelId);
          if (channel?.isTextBased() && (channel instanceof TextChannel || channel instanceof NewsChannel)) {
            const pingMsg = await channel.send({
              content: `<@&${clanRoleId}>, your link has expired.`,
            });

            // Delete the ping message after 5 seconds
            setTimeout(async () => {
              try {
                await pingMsg.delete();
              } catch (err) {
                logger.warn(`Failed to delete ping message: ${err}`);
              }
            }, 5000);

            logger.info(`Sent expiration ping for clan ${clantag}`);
          }
        } catch (err) {
          logger.error(`Failed to send expiration ping:`, err);
        }
      }
    } catch (error) {
      logger.error(`Error handling expired invite ${id}:`, error);
    }
  }
}
