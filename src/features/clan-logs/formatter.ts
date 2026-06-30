/**
 * Clan Activity Log Formatter
 *
 * Formats individual clan changes into Discord embeds with colors and icons
 */

import { EmbedBuilder, User } from 'discord.js';
import { ClanChange } from './types.js';
import { getEmoji } from '../../utils/emoji.js';
import { getClanBadgeEmoji } from '../race-tracking/service.js';

// Embed colors for different change types
const COLORS = {
  JOIN: 0x57f287, // Green
  LEAVE: 0xed4245, // Red
  ROLE_CHANGE: 0xfee75c, // Yellow
  PROPERTY_CHANGE: 0x5865f2, // Blue
} as const;

function getRoleDisplayName(role: string) {
  const roleMap: Record<string, string> = {
    member: 'Member',
    elder: 'Elder',
    coLeader: 'Co-leader',
    leader: 'Leader',
  };
  return roleMap[role] || 'Unknown Role'; // Default to "Unknown Role" if the role is not found
}

function getClanTypeDisplayName(type: string) {
  const typeMap: Record<string, string> = {
    closed: 'Closed',
    inviteOnly: 'Invite Only',
    open: 'Open',
  };
  return typeMap[type] || 'Unknown type';
}

function isPromotion(oldRole: string, newRole: string) {
  const roles = ['member', 'elder', 'coLeader', 'leader'];
  const oldRoleIndex = roles.indexOf(oldRole);
  const newRoleIndex = roles.indexOf(newRole);
  return newRoleIndex > oldRoleIndex;
}

/**
 * Format clan header with badge, name, and member count
 */
function formatClanHeader(
  clanName: string,
  clantag: string,
  badgeId: number,
  members: number,
  clanScore: number,
): string {
  const badge = getClanBadgeEmoji(badgeId, clanScore);
  return `${badge} **[${clanName}](<https://royaleapi.com/clan/${clantag.substring(1)}>)** (${members}/50)\n\n`;
}

/**
 * Format a single clan change into a Discord embed
 *
 * @param change - Individual change to format
 * @param discordUser - Optional Discord user info for linked players
 * @returns Discord embed with formatted change
 */
export function formatClanChange(change: ClanChange, discordUser?: User): EmbedBuilder {
  switch (change.type) {
    case 'member_join': {
      const clanHeader = formatClanHeader(
        change.clanName,
        change.clantag,
        change.badgeId,
        change.members,
        change.clanScore,
      );
      let description = clanHeader;
      description += `**${getRoleDisplayName(change.role)} joined!**\n`;
      description += `${getEmoji(change.arena.rawName)}\`${change.trophies}\` [${change.playerName}](<https://royaleapi.com/player/${change.playertag?.substring(1)}>)`;

      const embed = new EmbedBuilder().setColor(COLORS.JOIN).setDescription(description).setTimestamp();
      if (discordUser) {
        embed.setFooter({ text: discordUser.username, iconURL: discordUser.displayAvatarURL() });
      }
      return embed;
    }

    case 'member_leave': {
      const clanHeader = formatClanHeader(
        change.clanName,
        change.clantag,
        change.badgeId,
        change.members,
        change.clanScore,
      );
      let description = clanHeader;
      description += `**${getRoleDisplayName(change.role)} left!**\n`;
      description += `${getEmoji(change.arena.rawName)}\`${change.trophies}\` [${change.playerName}](<https://royaleapi.com/player/${change.playertag?.substring(1)}>)`;

      const embed = new EmbedBuilder().setColor(COLORS.LEAVE).setDescription(description).setTimestamp();
      if (discordUser) {
        embed.setFooter({ text: discordUser.username, iconURL: discordUser.displayAvatarURL() });
      }
      return embed;
    }

    case 'role_change': {
      const clanHeader = formatClanHeader(
        change.clanName,
        change.clantag,
        change.badgeId,
        change.members,
        change.clanScore,
      );
      let description = clanHeader;
      description += `**${isPromotion(change.oldRole, change.newRole) ? 'Promotion' : 'Demotion'}: ${getRoleDisplayName(change.oldRole)} → ${getRoleDisplayName(change.newRole)}**\n`;
      description += `${getEmoji(change.arena.rawName)}\`${change.trophies}\` [${change.playerName}](<https://royaleapi.com/player/${change.playertag?.substring(1)}>)`;

      const embed = new EmbedBuilder()
        .setColor(isPromotion(change.oldRole, change.newRole) ? COLORS.JOIN : COLORS.LEAVE)
        .setDescription(description)
        .setTimestamp();
      if (discordUser) {
        embed.setFooter({ text: discordUser.username, iconURL: discordUser.displayAvatarURL() });
      }
      return embed;
    }

    case 'clan_property_change': {
      const clanHeader = formatClanHeader(
        change.clanName,
        change.clantag,
        change.badgeId,
        change.members,
        change.clanScore,
      );
      const propertyName = formatPropertyName(change.property);
      const propertyDescription = formatPropertyChange(
        change.clanName,
        change.property,
        propertyName,
        change.oldValue,
        change.newValue,
      );
      const description = clanHeader + propertyDescription;

      // Use red/green colors for clan war trophy changes
      let embedColor: number = COLORS.PROPERTY_CHANGE;
      if (change.property === 'clanWarTrophies') {
        const oldTrophies = Number(change.oldValue);
        const newTrophies = Number(change.newValue);
        if (newTrophies < oldTrophies) {
          embedColor = COLORS.LEAVE; // Red for decrease
        } else if (newTrophies > oldTrophies) {
          embedColor = COLORS.JOIN; // Green for increase
        }
      }

      return new EmbedBuilder().setColor(embedColor).setDescription(description).setTimestamp();
    }

    default:
      // TypeScript exhaustiveness check - should never reach here
      return new EmbedBuilder().setColor(COLORS.PROPERTY_CHANGE).setDescription(`ℹ️ Unknown change`).setTimestamp();
  }
}

/**
 * Format property names to be more readable
 */
function formatPropertyName(property: string): string {
  const nameMap: Record<string, string> = {
    name: 'Clan Name',
    description: 'Description',
    requiredTrophies: 'Required Trophies',
    type: 'Clan Type',
    location: 'Location',
    clanWarTrophies: 'War Trophies',
    badgeId: 'Badge Icon',
  };
  return nameMap[property] || property;
}

/**
 * Format clan property changes with special icons and indicators
 */
function formatPropertyChange(
  clanName: string,
  property: string,
  propertyName: string,
  oldValue: string | number,
  newValue: string | number,
): string {
  // Handle trophy requirement changes with increase/decrease indicators
  if (property === 'requiredTrophies') {
    const oldTrophies = Number(oldValue);
    const newTrophies = Number(newValue);
    const indicator =
      newTrophies > oldTrophies
        ? 'Required Trophy Increase'
        : newTrophies < oldTrophies
          ? 'Required Trophy Decrease!'
          : 'No Change';
    return `**${indicator}**\n${getEmoji('trophyRoad')} \`${oldValue}\` → ${getEmoji('trophyRoad')} \`${newValue}\``;
  }

  // Handle clan type changes with lock/unlock icons
  if (property === 'type') {
    const oldIcon = getTypeIcon(String(oldValue));
    const newIcon = getTypeIcon(String(newValue));
    return `${oldIcon} **${getClanTypeDisplayName(oldValue as string)}** → ${newIcon} **${getClanTypeDisplayName(newValue as string)}**`;
  }

  // Handle location changes with globe icon
  if (property === 'location') {
    return `🌍 **Location Change**\n\`${oldValue}\` → \`${newValue}\``;
  }

  // Handle clan trophy changes with trophy icon
  if (property === 'clanWarTrophies') {
    const oldTrophies = Number(oldValue);
    const newTrophies = Number(newValue);
    const indicator =
      newTrophies > oldTrophies
        ? 'War Trophy Increase!'
        : newTrophies < oldTrophies
          ? 'War Trophy Decrease!'
          : 'No Change';
    return `**${indicator}**\n${getEmoji('warTrophy')} \`${oldValue}\` → ${getEmoji('warTrophy')} \`${newValue}\``;
  }

  // Handle badge ID changes with actual badge emojis
  if (property === 'badgeId') {
    const oldBadgeEmoji = getClanBadgeEmoji(Number(oldValue), 0);
    const newBadgeEmoji = getClanBadgeEmoji(Number(newValue), 0);
    return `**Badge Change**\n${oldBadgeEmoji}→ ${newBadgeEmoji}`;
  }

  if (property === 'description') {
    return `**Description Change**\n\`${oldValue}\`\n→\n\`${newValue}\``;
  }

  // Default format for other properties
  return `⚙️ **${clanName}** ${propertyName}: **${oldValue}** → **${newValue}**`;
}

/**
 * Get icon for clan type
 */
function getTypeIcon(type: string): string {
  const typeLower = type.toLowerCase();
  if (typeLower.includes('closed') || typeLower.includes('invite')) {
    return '🔒'; // Locked
  }
  return '🔓'; // Open
}
