import { EmbedBuilder } from 'discord.js';
import { normalizeTag } from '../../api/CR_API.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import type { ParsedInviteLink } from './types.js';

/**
 * Parse a Clash Royale invite link to extract the clantag and validate format
 */
export function parseInviteLink(inviteLink: string): ParsedInviteLink | null {
  const trimmedLink = inviteLink.trim();

  // Case-insensitive regex to validate format and extract the language code, tag, token, and platform
  const linkRegex =
    /https:\/\/link\.clashroyale\.com\/invite\/clan\/([a-z]{2})\?tag=([^&]*)&token=([^&]*)&platform=(android|ios)/i;

  const linkMatch = trimmedLink.match(linkRegex);

  if (!linkMatch || !linkMatch[2]) {
    return null;
  }

  const [, langCode, rawTag, token, platform] = linkMatch;
  const clantag = normalizeTag(rawTag);
  // Rebuild the link with the clan tag capitalized - the CR invite endpoint rejects lowercase tags
  const fullLink = `https://link.clashroyale.com/invite/clan/${langCode.toLowerCase()}?tag=${clantag.substring(1)}&token=${token}&platform=${platform.toLowerCase()}`;

  return {
    clantag,
    fullLink,
    platform: platform.toLowerCase() as 'android' | 'ios',
  };
}

/**
 * Format a clan invite link for display in Discord
 */
export function formatInviteLink(clanName: string, inviteLink: string, expiresAt: Date, members?: number): string {
  const expiryUnix = Math.floor(expiresAt.getTime() / 1000);
  const memberLine = members !== undefined ? ` | ${members}/50` : '';
  return `## **[Click here to join ${clanName}](<${inviteLink}>)**\n-# Expires: <t:${expiryUnix}:R>${memberLine}`;
}

/**
 * Create an invite embed for sending/displaying
 */
export function createInviteEmbed(
  clanName: string,
  inviteLink: string,
  expiresAt: Date,
  members?: number,
): EmbedBuilder {
  return new EmbedBuilder()
    .setDescription(formatInviteLink(clanName, inviteLink, expiresAt, members))
    .setColor(EmbedColor.SUCCESS);
}

/**
 * Check if an invite link is still valid (not expired)
 */
export function isInviteLinkValid(expiresAt: Date): boolean {
  return new Date(expiresAt) > new Date();
}
