import { EmbedBuilder, Message } from 'discord.js';
import type { GuildMessageContext } from '../../../cache/guildMessageContextCache.js';
import { checkPermissions } from '../../../utils/checkPermissions.js';
import { parseInviteLink } from '../utils.js';
import { processInviteLinkUpdate } from '../messageManager.js';
import { clanInviteService } from '../service.js';
import { isFeatureEnabled } from '../../../config/featureRegistry.js';
import { EmbedColor } from '../../../types/EmbedUtil.js';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';

const WARNING_DELETE_DELAY_MS = 5000;
const SHORTCUT_TOKEN_REGEX = /^!([a-z0-9]+)$/i;

/** Reply with an embed, delete the original message, then delete our reply a few seconds later. */
async function replyThenCleanUp(message: Message, embed: EmbedBuilder): Promise<void> {
  const reply = await message.reply({ embeds: [embed] });
  await message.delete().catch((err) => logger.error('Failed to delete clan invite message: %O', err));
  setTimeout(() => {
    reply.delete().catch((err) => logger.error('Failed to delete clan invite reply: %O', err));
  }, WARNING_DELETE_DELAY_MS);
}

export async function handleClanInvitePosted(message: Message, ctx: GuildMessageContext): Promise<boolean> {
  if (!ctx.clanInviteChannelId || message.channel.id !== ctx.clanInviteChannelId) return false;

  const parsedLink = parseInviteLink(message.content);
  if (!parsedLink) {
    const embed = new EmbedBuilder()
      .setDescription('❌ Invalid invite link format. Please provide a valid Clash Royale invite link.')
      .setColor(EmbedColor.FAIL);
    await replyThenCleanUp(message, embed);
    return true;
  }

  const member = message.member;
  if (!member) return false;

  const isOwner = message.guild!.ownerId === message.author.id;
  const requiredRoleIds = [...ctx.lowerLeaderRoleIds, ...ctx.higherLeaderRoleIds];

  const permEmbed = isOwner ? undefined : checkPermissions("use this channel's function", member, requiredRoleIds);
  if (permEmbed) {
    await replyThenCleanUp(message, permEmbed);
    return true;
  }

  // Same shared logic as /update-clan-invite and the "Update Link" modal.
  // Bails out (without posting) if the clantag isn't a linked family clan for this guild.
  const result = await processInviteLinkUpdate(
    message.guild!.id,
    parsedLink.clantag,
    parsedLink.fullLink,
    message.author.id,
    message.client,
  );

  await replyThenCleanUp(message, result.embed);
  return true;
}

/**
 * Lets staff post a clan's invite link anywhere by typing `!<abbreviation>`, e.g. `!a1` or `!coc !a1`.
 * If the message consists only of shortcut tokens, it's deleted after the link(s) are sent.
 */
export async function handleClanInviteSend(message: Message, ctx: GuildMessageContext): Promise<boolean> {
  if (!message.content.includes('!')) return false;

  const member = message.member;
  if (!member) return false;

  const isOwner = message.guild!.ownerId === message.author.id;
  const requiredRoleIds = [...ctx.lowerLeaderRoleIds, ...ctx.higherLeaderRoleIds];
  const permEmbed = isOwner ? undefined : checkPermissions('clan invite shortcuts', member, requiredRoleIds);
  if (permEmbed) return false;

  const tokens = message.content.trim().split(/\s+/).filter(Boolean);
  const abbreviations: string[] = [];
  let onlyShortcuts = tokens.length > 0;

  for (const token of tokens) {
    const match = token.match(SHORTCUT_TOKEN_REGEX);
    if (match) {
      abbreviations.push(match[1].toLowerCase());
    } else {
      onlyShortcuts = false;
    }
  }

  if (abbreviations.length === 0) return false;

  const guildId = message.guild!.id;
  if (!(await isFeatureEnabled(guildId, 'clan_invites'))) return false;

  let sentAny = false;
  for (const abbreviation of abbreviations) {
    const { rows } = await pool.query(
      `SELECT clan_name, clantag, invites_enabled FROM clans WHERE guild_id = $1 AND abbreviation = LOWER($2)`,
      [guildId, abbreviation],
    );
    if (!rows.length || !rows[0].invites_enabled) continue;

    const { clan_name: clanName, clantag } = rows[0];
    const sent = await clanInviteService.sendInviteToChannel(
      message.client,
      guildId,
      message.channel.id,
      clantag,
      '!shortcut',
      message.author.id,
    );
    if (sent) {
      sentAny = true;
    } else {
      const embed = new EmbedBuilder()
        .setDescription(`❌ The link for **${clanName}** is currently expired. Please generate a new invite.`)
        .setColor(EmbedColor.FAIL);
      await message.reply({ embeds: [embed] });
    }
  }

  if (sentAny && onlyShortcuts) {
    await message.delete().catch((err) => logger.error('Failed to delete clan invite shortcut message: %O', err));
  }

  return sentAny;
}
