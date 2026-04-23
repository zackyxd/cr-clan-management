import { pool } from '../../db.js';
import { DEFAULT_NUDGE_MESSAGE } from '../../config/constants.js';
import logger from '../../logger.js';
import {
  NewsChannel,
  TextChannel,
  type Client,
  type Guild,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ContainerBuilder,
} from 'discord.js';
import type { FormattedParticipant } from './attacksFormatter.js';
import {
  enrichParticipantsWithLinks,
  formatParticipantsList,
  buildFooterLegend,
} from './attacksFormatter.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';
import type { RaceAttacksData } from './types.js';

/**
 * Get the effective nudge message for a clan (custom or default)
 * @param guildId - Guild ID
 * @param clantag - Clan tag
 * @param raceDay - Optional race day number to replace {day} placeholder
 * @param customMessage - Optional custom message (if already fetched from DB). Pass null to explicitly use default.
 */
export async function getNudgeMessage(
  guildId: string,
  clantag: string,
  clanName: string,
  raceDay?: number,
  customMessage?: string | null,
): Promise<string> {
  let message: string;

  try {
    // If customMessage is explicitly provided (even if null), use it
    if (customMessage !== undefined) {
      message = customMessage || DEFAULT_NUDGE_MESSAGE;
    } else {
      // Otherwise, fetch from database
      const result = await pool.query(
        `SELECT race_custom_nudge_message FROM clans WHERE guild_id = $1 AND clantag = $2`,
        [guildId, clantag],
      );
      message = result.rows[0]?.race_custom_nudge_message || DEFAULT_NUDGE_MESSAGE;
    }

    // Replace {clanName} placeholder with actual clan name
    return message.replace(/{clanName}/g, String(clanName || '?'));
  } catch (error) {
    logger.error('Error getting nudge message:', error);
    return DEFAULT_NUDGE_MESSAGE.replace(/{clanName}/g, String(clanName || '?'));
  }
}

/**
 * Reset custom nudge message to default on new war day
 * Called when isNewWarDay() returns true
 */
export async function resetCustomNudgeMessageOnNewDay(client: Client, guildId: string, clantag: string): Promise<void> {
  try {
    // Check if clan had a custom message
    const result = await pool.query(
      `SELECT race_custom_nudge_message, clan_name, staff_channel_id 
       FROM clans WHERE guild_id = $1 AND clantag = $2`,
      [guildId, clantag],
    );

    const hadCustomMessage = result.rows[0]?.race_custom_nudge_message;
    const clanName = result.rows[0]?.clan_name;
    const staffChannelId = result.rows[0]?.staff_channel_id;

    if (!hadCustomMessage) {
      // No custom message to reset
      return;
    }

    // Reset to default (null = use default)
    await pool.query(`UPDATE clans SET race_custom_nudge_message = NULL WHERE guild_id = $1 AND clantag = $2`, [
      guildId,
      clantag,
    ]);

    // Send notification to staff channel
    if (staffChannelId) {
      try {
        const channel = await client.channels.fetch(staffChannelId);
        if (channel && (channel instanceof TextChannel || channel instanceof NewsChannel)) {
          await channel.send({
            content: `🔄 **${clanName}**: Custom nudge message has been reset to default for the new war day.\n\nTo set a new custom message, use \`/clan-settings\` → **Custom Nudge Message**.`,
          });
        }
      } catch (channelError) {
        logger.error('Error sending custom message reset notification:', channelError);
      }
    }

    logger.info(`Reset custom nudge message for clan ${clantag} in guild ${guildId} on new war day`);
  } catch (error) {
    logger.error('Error resetting custom nudge message:', error);
  }
}

export async function trackNudge(
  raceId: number,
  clantag: string,
  raceWeek: number,
  raceDay: number,
  nudgeType: 'manual' | 'automatic',
  message: string,
  participants: FormattedParticipant[],
): Promise<void> {
  // Build snapshot of all participants with nudge status
  const playersSnapshot = participants.map((p) => ({
    playertag: p.playertag,
    name: p.playerName,
    nudged: p.attacksRemaining > 0 || p.isSplitAttacker || p.hasAttackedElsewhere,
    attacks_remaining: p.attacksRemaining,
    attacks_used_today: p.attacksUsedToday,
    linked: !!p.discordUserId,
    has_channel_access: p.hasChannelAccess ?? null,
    ping_user: p.pingUser,
    split_attacker: p.isSplitAttacker,
    attacked_elsewhere: p.hasAttackedElsewhere,
    is_replacement: p.isReplacementPlayer,
    is_attacking_late: p.isAttackingLate,
    is_in_clan: p.isInClan,
  }));

  await pool.query(
    `
    INSERT INTO race_nudges
    (race_id, clantag, race_week, race_day, nudge_type, message, players_snapshot)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [raceId, clantag, raceWeek, raceDay, nudgeType, message, JSON.stringify(playersSnapshot)],
  );
}

/**
 * Build a complete nudge message with Components v2 formatting
 * Returns null if there are no players to nudge
 */
export async function buildNudgeComponents(
  guild: Guild,
  attacksData: RaceAttacksData,
  message: string,
  channelId: string,
): Promise<{
  components: ContainerBuilder[];
  enrichedParticipants: FormattedParticipant[];
} | null> {
  // Enrich participants with Discord linking and channel access
  const enrichedParticipants = await enrichParticipantsWithLinks(guild.id, attacksData.participants, {
    mentionUsers: true,
    channelId: channelId,
    guild: guild,
  });

  // Format participant lines with mentions
  const lines = formatParticipantsList(
    enrichedParticipants,
    attacksData.totalAttacksRemaining,
    attacksData.availableAttackers,
    {
      mentionUsers: true,
      channelId: channelId,
      guild: guild,
    },
  );

  if (lines.length === 0) {
    return null; // No players to nudge
  }

  // Build footer legend
  const footerText = buildFooterLegend(enrichedParticipants, {
    mentionUsers: true,
    channelId: channelId,
    guild: guild,
  });

  // Build Components v2 message with builders
  const nudgeText = new TextDisplayBuilder().setContent(message);
  const separator1 = new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
  const participantsList = new TextDisplayBuilder().setContent(lines.join('\n'));

  const container = new ContainerBuilder()
    .setAccentColor(BOTCOLOR)
    .addTextDisplayComponents(nudgeText)
    .addSeparatorComponents(separator1)
    .addTextDisplayComponents(participantsList);

  // Add footer if present
  if (footerText) {
    const separator2 = new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
    const footer = new TextDisplayBuilder().setContent(footerText);
    container.addSeparatorComponents(separator2).addTextDisplayComponents(footer);
  }

  return {
    components: [container],
    enrichedParticipants,
  };
}
