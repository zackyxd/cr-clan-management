import { ButtonInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { pool } from '../db.js';
import { EmbedColor } from '../types/EmbedUtil.js';

export interface StoredInviteLink {
  clantag: string;
  clan_name?: string;
  active_clan_link: string;
  active_clan_link_expiry_time: Date;
}

/**
 * Get the most recent valid invite link for a clan
 */
export async function getValidInviteLink(guildId: string, clantag: string): Promise<StoredInviteLink | null> {
  const result = await pool.query(
    `
    SELECT clantag, clan_name, active_clan_link, active_clan_link_expiry_time
    FROM clans
    WHERE guild_id = $1 AND clantag = $2 AND active_clan_link IS NOT NULL AND active_clan_link_expiry_time > NOW()
    `,
    [guildId, clantag]
  );

  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Store a new invite link in the database
 */
export async function storeInviteLink(
  guildId: string,
  clantag: string,
  inviteLink: string,
  sentBy: string,
  messageId: string,
  expiresAt: Date
): Promise<void> {
  await pool.query(
    `
    INSERT INTO clan_invites (guild_id, clantag, invite_link, sent_by, message_id, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [guildId, clantag, inviteLink, sentBy, messageId, expiresAt]
  );
}

/**
 * Delete expired invite links (cleanup function)
 */
export async function cleanupExpiredInvites(): Promise<void> {
  await pool.query(
    `
    DELETE FROM clan_invites
    WHERE expires_at < NOW()
    `
  );
}

/**
 * Grab an invite link for a clan
 */
export async function grabInviteLink(
  guildId: string,
  clantag: string
): Promise<{ validLink: string | null; expiry: Date | null }> {
  // First, try to get an existing valid invite link
  const existingInvite = await getValidInviteLink(guildId, clantag);

  if (!existingInvite) {
    return { validLink: null, expiry: null };
  }

  return { validLink: existingInvite.active_clan_link, expiry: existingInvite.active_clan_link_expiry_time };
}

export async function sendInviteLink(
  interaction: ButtonInteraction,
  channelId: string,
  content: string,
  clantag: string,
  clanName: string
) {
  // 1. Grab valid link
  const { validLink, expiry } = await grabInviteLink(interaction.guildId!, clantag);
  console.log(validLink, expiry);
  // 2. Check if validLink exists
  if (!validLink || !expiry) {
    const embed = new EmbedBuilder()
      .setDescription(`There is currently no active clan link for **${clanName}**.\nPlease generate a new one.`)
      .setColor(EmbedColor.FAIL);
    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return null;
  }

  const inviteLinkEmbed = new EmbedBuilder()
    .setDescription(`${formatClanLink(clanName, validLink, expiry)}`)
    .setColor(EmbedColor.SUCCESS);
  const targetChannel = await interaction.guild?.channels.fetch(channelId);
  if (targetChannel && targetChannel.isTextBased()) {
    await targetChannel.send({ content: content, embeds: [inviteLinkEmbed] });
  } else {
    const embed = new EmbedBuilder()
      .setDescription(`❌ Could not find the target channel to send the invite link.`)
      .setColor(EmbedColor.FAIL);
    await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return null;
  }
}

function formatClanLink(clanName: string, clanLink: string, expiryTime: Date): string {
  return `## **[Click here to join ${clanName}](<${clanLink}>)**\n-# Expires: <t:${Math.floor(
    expiryTime.getTime() / 1000
  )}:R>`;
}
