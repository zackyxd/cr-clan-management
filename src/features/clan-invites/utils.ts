import { EmbedBuilder } from 'discord.js';
import { normalizeTag } from '../../api/CR_API.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import type { ParsedInviteLink } from './types.js';

/**
 * Parse a Clash Royale invite link to extract the clantag and validate format
 */
export function parseInviteLink(inviteLink: string): ParsedInviteLink | null {
  const cleanLink = inviteLink.trim().toLowerCase();

  // Regex to extract clantag
  const tagRegex = /\/invite\/.*tag=([^&]*)/;
  // Regex to validate full link format
  const linkRegex =
    /https:\/\/link\.clashroyale\.com\/invite\/clan\/[a-z]{2}\?tag=[^&]*&token=[^&]*&platform=(android|ios)/;

  const tagMatch = cleanLink.match(tagRegex);
  const linkMatch = cleanLink.match(linkRegex);

  if (!tagMatch || !tagMatch[1] || !linkMatch || !linkMatch[1]) {
    return null;
  }

  return {
    clantag: normalizeTag(tagMatch[1]),
    fullLink: linkMatch[0],
    platform: linkMatch[1] as 'android' | 'ios',
  };
}

/**
 * Format a clan invite link for display in Discord
 */
export function formatInviteLink(clanName: string, inviteLink: string, expiresAt: Date): string {
  const expiryUnix = Math.floor(expiresAt.getTime() / 1000);
  return `## **[Click here to join ${clanName}](<${inviteLink}>)**\n-# Expires: <t:${expiryUnix}:R>`;
}

/**
 * Create an invite embed for sending/displaying
 */
export function createInviteEmbed(clanName: string, inviteLink: string, expiresAt: Date): EmbedBuilder {
  return new EmbedBuilder()
    .setDescription(formatInviteLink(clanName, inviteLink, expiresAt))
    .setColor(EmbedColor.SUCCESS);
}

/**
 * Check if an invite link is still valid (not expired)
 */
export function isInviteLinkValid(expiresAt: Date): boolean {
  return new Date(expiresAt) > new Date();
}
