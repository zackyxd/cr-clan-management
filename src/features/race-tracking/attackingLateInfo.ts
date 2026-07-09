import { pool } from '../../db.js';
import { CR_API, isFetchError } from '../../api/CR_API.js';
import { NudgeTrackingScheduler } from './nudgeScheduler.js';
import logger from '../../logger.js';

const GENERIC_LATE_INFO =
  "You will be skipped for the first half of your clan's nudges and pinged during the last half.";

const WAR_END_TOTAL_MINUTES = 9 * 60; // War day runs 9:00 UTC to 9:00 UTC

/**
 * Build the explanation shown to a user after marking themselves attacking-late.
 *
 * If the user has exactly one linked account, look up that account's current clan
 * (no battle-log guessing) and append the time of the next nudge that will ping
 * them — but only if that nudge is still upcoming in the current war day.
 * Otherwise return the generic "last half of nudges" message.
 */
export async function buildAttackingLateInfo(guildId: string, discordId: string): Promise<string> {
  try {
    const linked = await pool.query(
      `SELECT playertag FROM user_playertags WHERE guild_id = $1 AND discord_id = $2`,
      [guildId, discordId],
    );
    if (linked.rows.length !== 1) return GENERIC_LATE_INFO;

    const player = await CR_API.getPlayer(linked.rows[0].playertag);
    if (isFetchError(player) || !player?.clan?.tag) return GENERIC_LATE_INFO;

    const clanRes = await pool.query(
      `SELECT clan_name, nudge_method, race_nudge_start_hour, race_nudge_start_minute,
              race_nudge_interval_hours, race_nudge_hours_before_array
       FROM clans
       WHERE guild_id = $1 AND clantag = $2`,
      [guildId, player.clan.tag],
    );
    if (clanRes.rows.length === 0) return GENERIC_LATE_INFO;

    const clan = clanRes.rows[0];
    let context: { totalNudges: number; nudgeTimes: { hour: number; minute: number }[] } | null = null;

    if (
      clan.nudge_method === 'interval' &&
      clan.race_nudge_start_hour !== null &&
      clan.race_nudge_start_minute !== null &&
      clan.race_nudge_interval_hours !== null
    ) {
      context = NudgeTrackingScheduler.calculateNudgeContext(
        clan.race_nudge_start_hour,
        clan.race_nudge_start_minute,
        clan.race_nudge_interval_hours,
      );
    } else if (
      clan.nudge_method === 'hours_before_end' &&
      clan.race_nudge_hours_before_array &&
      clan.race_nudge_hours_before_array.length > 0
    ) {
      context = NudgeTrackingScheduler.calculateHoursBeforeEndContext(clan.race_nudge_hours_before_array);
    }

    if (!context || context.totalNudges === 0) return GENERIC_LATE_INFO;

    if (context.totalNudges === 1) {
      return `${GENERIC_LATE_INFO}\n\n-# ${clan.clan_name} only has 1 nudge configured, so you will still be pinged.`;
    }

    // Find the first last-half nudge that is still upcoming in the current war day,
    // comparing minutes elapsed since the 9:00 UTC war-day boundary
    const skipCount = Math.ceil(context.totalNudges / 2);
    const now = new Date();
    const nowWarDayMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() - WAR_END_TOTAL_MINUTES + 1440) % 1440;

    for (let i = skipCount; i < context.nudgeTimes.length; i++) {
      const time = context.nudgeTimes[i];
      const nudgeWarDayMinutes = (time.hour * 60 + time.minute - WAR_END_TOTAL_MINUTES + 1440) % 1440;
      if (nudgeWarDayMinutes <= nowWarDayMinutes) continue;

      // Convert to a calendar timestamp (may land after midnight, still the same war day)
      const nextDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), time.hour, time.minute, 0),
      );
      if (nextDate.getTime() <= now.getTime()) {
        nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      }
      const unixTimestamp = Math.floor(nextDate.getTime() / 1000);
      return `${GENERIC_LATE_INFO}\n\n-# All members for ${clan.clan_name} will be pinged on the <t:${unixTimestamp}:t> nudge (${i + 1}/${context.totalNudges}).`;
    }

    // No full-ping nudges left in the current war day
    return GENERIC_LATE_INFO;
  } catch (error) {
    logger.error('Error building attacking-late info:', error);
    return GENERIC_LATE_INFO;
  }
}
