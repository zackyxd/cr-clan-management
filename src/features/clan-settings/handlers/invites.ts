/**
 * Clan Invites Settings Handler
 *
 * Handles two actions:
 * 1. Toggle invites enabled/disabled
 * 2. Purge all active clan invites
 */

import { ButtonInteraction, EmbedBuilder, MessageFlags, TextChannel, NewsChannel } from 'discord.js';
import { pool } from '../../../db.js';
import { clanSettingsService } from '../service.js';
import { clanInviteService } from '../../clan-invites/service.js';
import { EmbedColor } from '../../../types/EmbedUtil.js';
import { updateClanSettingsView } from './helpers.js';
import type { ClanSettingsData } from '../types.js';
import logger from '../../../logger.js';

interface ActiveInviteWithMessages {
  invite_link_id: number;
  guild_id: string;
  clantag: string;
  clan_name: string;
  invite_link: string;
  expires_at: Date;
  messages: Array<{
    id: number;
    message_id: string;
    channel_id: string;
    source_type: string;
    sent_by_id: string;
  }>;
}

interface FailedMessage {
  messageId: string;
  channelId: string;
  error?: string;
}

export class InvitesHandler {
  /**
   * Handle invites enabled toggle button interaction
   *
   * @param interaction - Button interaction from Discord
   * @param settingsData - Cached settings data (from cache key)
   */
  static async toggle(interaction: ButtonInteraction, settingsData: ClanSettingsData): Promise<void> {
    const { guildId, clantag, clanName } = settingsData;

    try {
      // Call service layer to toggle invites
      const result = await clanSettingsService.toggleInvitesEnabled(
        interaction.client,
        guildId,
        clantag,
        interaction.user.id,
      );

      if (!result.success) {
        await interaction.editReply({
          content: result.error || 'Failed to toggle invite setting',
        });
        return;
      }

      // Handle invite message update if needed
      if (result.inviteUpdateNeeded && result.inviteSettings) {
        try {
          await clanSettingsService.handleInviteMessageUpdate(result.inviteSettings, guildId, interaction.client);
        } catch {
          // Error updating invite message
          const embed = new EmbedBuilder()
            .setDescription(
              'Setting updated, but could not update invite message. Please check the invite channel setup.',
            )
            .setColor(EmbedColor.WARNING);
          await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
      }

      // Show warning message if invite settings aren't configured
      if (result.warning) {
        const embed = new EmbedBuilder().setDescription(result.warning).setColor(EmbedColor.SUCCESS);
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      // Success - update the settings view
      await updateClanSettingsView(interaction, guildId, clantag, clanName);

      logger.info(`[Invites] ${interaction.user.tag} toggled invites for ${clanName} (${clantag}) in guild ${guildId}`);
    } catch (error) {
      logger.error('[Invites] Error toggling invites:', error);

      await interaction.editReply({
        content: '❌ An unexpected error occurred while updating invite setting.',
      });
    }
  }

  /**
   * Handle purge invites action - deletes all existing invites for the clan
   * Only higher-staff roles can use this button.
   *
   * @param interaction - Button interaction from Discord
   * @param settingsData - Cached settings data (from cache key)
   */
  static async purge(interaction: ButtonInteraction, settingsData: ClanSettingsData): Promise<void> {
    const { guildId, clantag, clanName } = settingsData;

    try {
      // Query for all active invites with their message locations
      const result = await pool.query<ActiveInviteWithMessages>(
        `
        SELECT 
          cil.id as invite_link_id,
          cil.guild_id,
          cil.clantag,
          c.clan_name,
          cil.invite_link,
          cil.expires_at,
          array_agg(
            json_build_object(
              'id', ilm.id,
              'message_id', ilm.message_id,
              'channel_id', ilm.channel_id,
              'source_type', ilm.source_type,
              'sent_by_id', ilm.sent_by_id
            )
          ) AS messages
        FROM clan_invite_links cil
        INNER JOIN invite_link_messages ilm ON ilm.invite_link_id = cil.id
        LEFT JOIN clans c ON c.guild_id = cil.guild_id AND c.clantag = cil.clantag
        WHERE cil.guild_id = $1 
          AND cil.clantag = $2
          AND cil.expires_at > NOW() 
          AND cil.is_expired = FALSE
        GROUP BY cil.id, cil.guild_id, cil.clantag, c.clan_name, cil.invite_link, cil.expires_at
      `,
        [guildId, clantag],
      );

      let deletedCount = 0;
      const failedMessages: FailedMessage[] = [];
      const unknownChannel: FailedMessage[] = [];

      // Attempt to delete each message
      for (const inviteData of result.rows) {
        const validMessages = inviteData.messages?.filter((msg) => msg.message_id && msg.channel_id) || [];

        for (const msg of validMessages) {
          try {
            const channel = await interaction.client.channels.fetch(msg.channel_id);
            if (!channel?.isTextBased() || !(channel instanceof TextChannel || channel instanceof NewsChannel)) {
              failedMessages.push({
                messageId: msg.message_id,
                channelId: msg.channel_id,
                error: 'Channel not accessible',
              });
              continue;
            }

            const message = await channel.messages.fetch(msg.message_id);
            await message.delete();
            deletedCount++;
            logger.info(`[Invites] Deleted message ${msg.message_id} in channel ${msg.channel_id}`);
          } catch (deleteErr: unknown) {
            const error = deleteErr as { code?: number; message?: string };

            if (error.code === 10008) {
              // Message already deleted, count as success
              deletedCount++;
            } else if (error.code === 10003) {
              // Unknown channel (bot can't see it)
              unknownChannel.push({
                messageId: msg.message_id,
                channelId: msg.channel_id,
                error: 'Cannot see channel',
              });
            } else {
              failedMessages.push({
                messageId: msg.message_id,
                channelId: msg.channel_id,
                error: error.message || 'Unknown error',
              });
            }
          }
        }
      }

      // Build reply with results
      let replyContent = `✅ Deleted ${deletedCount} invite message(s) for ${clanName}.`;

      if (unknownChannel.length > 0) {
        replyContent += `\n\n⚠️ Could not delete ${unknownChannel.length} message(s) due to missing channel access.`;
      }
      if (failedMessages.length > 0) {
        replyContent += `\n\n⚠️ Failed to delete ${failedMessages.length} message(s):`;
        for (const failed of failedMessages) {
          replyContent += `\n-# https://discord.com/channels/${guildId}/${failed.channelId}/${failed.messageId} (${failed.error})`;
        }
      }

      const message = await interaction.followUp({
        content: replyContent,
        ephemeral: true,
      });

      // Send audit log if successful
      if (message) {
        await clanInviteService.sendLog(
          interaction.client,
          guildId,
          '🧹 Clan Invites Purged',
          `**Purged by:** <@${interaction.user.id}>\n**Clan:** ${clanName}\n**Tag:** ${clantag}\n**Deleted Links:** ${deletedCount}\n**Unknown Channel Access:** ${unknownChannel.length}\n**Failed Deletions:** ${failedMessages.length}`,
        );
      }

      logger.info(
        `[Invites] ${interaction.user.tag} purged ${deletedCount} invites for ${clanName} (${clantag}) in guild ${guildId}`,
      );
    } catch (error) {
      logger.error('[Invites] Error purging invites:', error);

      await interaction.followUp({
        content: '❌ An unexpected error occurred while purging invites.',
        ephemeral: true,
      });
    }
  }
}
