import { Guild } from 'discord.js';
import { pool } from '../../db.js';
import type { ParticipantWithAttacks } from './types.js';

export interface FormattedParticipant extends ParticipantWithAttacks {
  hasChannelAccess?: boolean;
}

export interface FormatOptions {
  /** Whether to mention/ping users if linked */
  mentionUsers: boolean;
  /** Channel ID to check access for (if mentioning) */
  channelId?: string;
  /** Guild to check permissions in */
  guild?: Guild;
  /** Current nudge number (1-based) for attacking-late logic */
  currentNudgeNumber?: number;
  /** Total nudges in the cycle for attacking-late logic */
  totalNudges?: number;
}

/**
 * Get Discord user IDs for linked player tags
 * Returns map of playerTag -> userId
 */
export async function getLinkedAccounts(guildId: string, playertags: string[]): Promise<Map<string, string>> {
  if (playertags.length === 0) return new Map();

  const result = await pool.query(
    `SELECT playertag, discord_id 
     FROM user_playertags 
     WHERE guild_id = $1 AND playertag = ANY($2)`,
    [guildId, playertags],
  );

  const linkedAccounts = new Map<string, string>();
  for (const row of result.rows) {
    linkedAccounts.set(row.playertag, row.discord_id);
  }

  return linkedAccounts;
}

/**
 * Check if users have access to a channel
 * Returns map of userId -> hasAccess
 */
export async function checkChannelAccess(
  guild: Guild,
  channelId: string,
  userIds: string[],
): Promise<Map<string, boolean>> {
  const accessMap = new Map<string, boolean>();

  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel) return accessMap;

    for (const userId of userIds) {
      try {
        const member = await guild.members.fetch(userId);
        const canView = channel.permissionsFor(member)?.has('ViewChannel') ?? false;
        accessMap.set(userId, canView);
      } catch {
        accessMap.set(userId, false);
      }
    }
  } catch {
    // Channel not found or error - assume no access
    userIds.forEach((id) => accessMap.set(id, false));
  }

  return accessMap;
}

/**
 * Enrich participants with Discord linking data
 */
export async function enrichParticipantsWithLinks(
  guildId: string,
  participants: ParticipantWithAttacks[],
  options: FormatOptions,
): Promise<FormattedParticipant[]> {
  const playertags = participants.map((p) => p.playertag);
  const linkedAccounts = await getLinkedAccounts(guildId, playertags);

  // Get all linked user IDs
  const linkedUserIds = Array.from(linkedAccounts.values());

  // Check channel access if needed
  let channelAccessMap = new Map<string, boolean>();
  if (options.mentionUsers && options.channelId && options.guild && linkedUserIds.length > 0) {
    channelAccessMap = await checkChannelAccess(options.guild, options.channelId, linkedUserIds);
  }

  // Enrich participants
  return participants.map((participant) => {
    const userId = linkedAccounts.get(participant.playertag);
    const hasAccess = userId ? (channelAccessMap.get(userId) ?? true) : undefined;

    return {
      ...participant,
      discordUserId: userId,
      hasChannelAccess: hasAccess,
    };
  });
}

/**
 * Format a single participant line
 */
export function formatParticipantLine(participant: FormattedParticipant, options: FormatOptions): string {
  let line = '* ';

  // Determine if we should ping this user
  let shouldMention = options.mentionUsers && participant.discordUserId && participant.pingUser;

  // NEVER ping replacement players
  if (participant.isReplacementPlayer) {
    shouldMention = false;
  }

  // Skip attacking-late players for first half of nudges
  if (participant.isAttackingLate && options.currentNudgeNumber && options.totalNudges) {
    const skipCount = Math.ceil(options.totalNudges / 2);
    if (options.currentNudgeNumber <= skipCount) {
      shouldMention = false;
    }
  }

  // Player mention or name
  if (shouldMention) {
    line += `<@${participant.discordUserId}> (${participant.playerName})`;

    // Add different emoji if they don't have channel access
    if (participant.hasChannelAccess === false) {
      line += ' 🔒'; // Locked - can't see this channel
    }
  } else {
    line += participant.playerName;
  }

  // Add emojis for special statuses
  if (participant.isSplitAttacker) {
    line += ' ☠️';
  }
  if (participant.hasAttackedElsewhere) {
    line += ' 🚫';
  }
  if (participant.isReplacementPlayer) {
    line += ' ⚠️';
  }
  // Only show clock if they're NOT getting pinged (either skipped or no mention at all)
  if (participant.isAttackingLate && !shouldMention) {
    line += ' ⏰';
  }
  if (!participant.isInClan) {
    line += ' ❌';
  }

  // Show attacks used today in this clan
  if (participant.isSplitAttacker || participant.isReplacementPlayer) {
    line += ` (Used ${participant.attacksUsedToday} in clan)`;
  }

  // Show which clans they attacked in if they have attacks elsewhere
  if (participant.clansAttackedIn.length > 1 || participant.hasAttackedElsewhere) {
    line += ` — *Attacked in: ${participant.clansAttackedIn.join(' & ')}*`;
  }

  return line;
}

/**
 * Group participants by attacks remaining and format lines
 */
export function formatParticipantsList(
  participants: FormattedParticipant[],
  attacksLeft: number,
  playersRemaining: number,
  options: FormatOptions,
): string[] {
  const lines: string[] = [];

  // Filter out completed non-violators
  const filteredParticipants = participants.filter(
    (p) => p.attacksRemaining > 0 || p.isSplitAttacker || p.hasAttackedElsewhere,
  );

  // Count participants per attack group
  const groupCounts = new Map<number, number>();
  for (const participant of filteredParticipants) {
    groupCounts.set(participant.attacksRemaining, (groupCounts.get(participant.attacksRemaining) || 0) + 1);
  }

  // Group by attacks remaining
  let currentAttacksGroup = -1;

  for (const participant of filteredParticipants) {
    // Add section header when entering new attack count group
    if (participant.attacksRemaining !== currentAttacksGroup) {
      currentAttacksGroup = participant.attacksRemaining;
      const count = groupCounts.get(currentAttacksGroup) || 0;
      if (lines.length > 0) lines.push(''); // Blank line between groups
      lines.push(`__**${currentAttacksGroup} Attack${currentAttacksGroup !== 1 ? 's' : ''} (${count})**__`);
    }

    // Format participant line
    lines.push(formatParticipantLine(participant, options));
  }

  // TODO emojis
  lines.push(`\n:playersLeft: ${playersRemaining}\n:attacksLeft: ${attacksLeft}`);

  return lines;
}

/**
 * Build footer legend based on what statuses are present
 */
export function buildFooterLegend(participants: FormattedParticipant[], options: FormatOptions): string {
  const footerParts: string[] = [];
  const filteredParticipants = participants.filter(
    (p) => p.attacksRemaining > 0 || p.isSplitAttacker || p.hasAttackedElsewhere,
  );

  const hasSplitAttackers = filteredParticipants.some((p) => p.isSplitAttacker);
  const hasAttackedElsewhere = filteredParticipants.some((p) => p.hasAttackedElsewhere);
  const hasReplacementPlayers = filteredParticipants.some((p) => p.isReplacementPlayer);

  // Only show attacking-late legend if there are players who ARE attacking late but NOT being pinged yet
  const hasAttackingLateWithoutPing = filteredParticipants.some((p) => {
    if (!p.isAttackingLate) return false;

    // Check if they would be skipped (same logic as formatParticipantLine)
    if (options.currentNudgeNumber && options.totalNudges) {
      const skipCount = Math.ceil(options.totalNudges / 2);
      return options.currentNudgeNumber <= skipCount; // Only show if currently skipped
    }

    return true; // Show if no nudge context
  });

  const hasLeftClan = filteredParticipants.some((p) => !p.isInClan);
  const hasLockedUsers = options.mentionUsers && filteredParticipants.some((p) => p.hasChannelAccess === false);

  if (options.mentionUsers && hasLockedUsers) footerParts.push('🔒 = Cannot access channel\n');
  if (hasSplitAttackers) footerParts.push('☠️ = Split attacker\n');
  if (hasAttackedElsewhere) footerParts.push('🚫 = Do not attack (started elsewhere)\n');
  if (hasReplacementPlayers) footerParts.push('⚠️ = Replace me\n');
  if (hasAttackingLateWithoutPing) footerParts.push('⏰ = Attacking late\n');
  if (hasLeftClan) footerParts.push('❌ = Left clan\n');

  return footerParts.join('');
}
