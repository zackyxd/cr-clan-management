import { Client, TextChannel, MessageFlags, EmbedBuilder } from 'discord.js';
import { pool } from '../../db.js';
import logger from '../../logger.js';
import { getRaceAttacks, initializeOrUpdateRace } from './service.js';
import { trackNudge, getNudgeMessage, buildNudgeComponents } from './nudgeHelper.js';
import { isDev } from '../../utils/env.js';
import { getNextDayRelativeTimestamp } from './timeUtils.js';
import cron from 'node-cron';
import { EmbedColor } from '../../types/EmbedUtil.js';

interface ScheduledNudge {
  race_id: number;
  clantag: string;
  guild_id: string;
  clan_name: string;
  staff_channel_id: string;
  race_nudge_channel_id: string;
  nudge_method: 'disabled' | 'interval' | 'hours_before_end';
  race_nudge_start_hour: number | null; // 0-23 (UTC)
  race_nudge_start_minute: number | null; // 0-59 (UTC)
  race_nudge_interval_hours: number | null;
  race_nudge_hours_before_array: number[] | null;
  race_custom_nudge_message: string | null;
  current_day: number;
  current_week: number;
  race_state: string;
  end_time: Date;
}

/**
 *
 * Race Tracking Scheduler
 * Handles automatic nudge sending at scheduled times.
 *
 */

export class NudgeTrackingScheduler {
  private task: cron.ScheduledTask | null = null;

  constructor(private client: Client) {
    logger.info('Nudge scheduler initialized');
  }

  start() {
    if (this.task) return;

    // Run every minute at :00 seconds (UTC)
    this.task = cron.schedule(
      '* * * * *',
      () => {
        this.checkScheduledTasks();
      },
      {
        timezone: 'Etc/UTC',
      },
    );

    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setUTCMinutes(nextRun.getUTCMinutes() + 1);
    nextRun.setUTCSeconds(0);
    nextRun.setUTCMilliseconds(0);

    logger.info(
      `⏰ Nudge scheduler started - runs every 1 minute at :00 seconds UTC (next: ${String(nextRun.getUTCHours()).padStart(2, '0')}:${String(nextRun.getUTCMinutes()).padStart(2, '0')}:00)`,
    );
  }

  /**
   * Calculate all nudge times and find current nudge number based on current UTC time
   * Returns { currentNudgeNumber, totalNudges } or null if outside nudge window
   */
  static calculateNudgeContext(
    startHour: number,
    startMinute: number,
    intervalHours: number,
  ): { currentNudgeNumber: number; totalNudges: number; nudgeTimes: { hour: number; minute: number }[] } {
    const STOP_HOUR = 9;
    const STOP_MINUTE = 0;
    const stopTotalMinutes = STOP_HOUR * 60 + STOP_MINUTE;

    // Calculate all nudge times
    const nudgeTimes: { hour: number; minute: number }[] = [];
    const startTotalMinutes = startHour * 60 + startMinute;
    const crossesMidnight = startTotalMinutes >= stopTotalMinutes;

    let i = 0;
    while (true) {
      const totalMinutes = startTotalMinutes + i * intervalHours * 60;
      const hour = Math.floor(totalMinutes / 60) % 24;
      const minute = totalMinutes % 60;
      const currentMinutes = hour * 60 + minute;

      if (crossesMidnight) {
        if (currentMinutes > stopTotalMinutes && currentMinutes < startTotalMinutes) {
          break;
        }
      } else {
        if (currentMinutes > stopTotalMinutes) {
          break;
        }
      }

      nudgeTimes.push({ hour, minute });
      i++;
    }

    // Find which nudge we're currently at (based on current UTC time)
    const now = new Date();
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();

    // Find the most recent nudge time that has passed (not the next upcoming one)
    // This ensures attacking-late logic only pings based on nudges that already happened
    let currentNudgeNumber = 1; // Default to first nudge if none have passed yet
    const nowMinutes = currentHour * 60 + currentMinute;

    // Iterate backwards to find the most recent nudge that has passed
    for (let idx = nudgeTimes.length - 1; idx >= 0; idx--) {
      const nudgeTime = nudgeTimes[idx];
      const nudgeMinutes = nudgeTime.hour * 60 + nudgeTime.minute;

      // Handle midnight wraparound
      if (crossesMidnight) {
        // Check if this nudge time has passed
        // For schedules that cross midnight, we need to handle wrap-around
        if (nowMinutes < stopTotalMinutes) {
          // Current time is after midnight (e.g., 1am)
          // A nudge has passed if it's after midnight and before now, OR if it was before midnight yesterday
          if ((nudgeMinutes < stopTotalMinutes && nudgeMinutes <= nowMinutes) || nudgeMinutes >= startTotalMinutes) {
            currentNudgeNumber = idx + 1;
            break;
          }
        } else {
          // Current time is before midnight (e.g., 10pm)
          // A nudge has passed if it's before midnight and before/at now
          if (nudgeMinutes >= startTotalMinutes && nudgeMinutes <= nowMinutes) {
            currentNudgeNumber = idx + 1;
            break;
          }
        }
      } else {
        // No midnight crossing - simple comparison
        if (nudgeMinutes <= nowMinutes) {
          currentNudgeNumber = idx + 1;
          break;
        }
      }
    }

    // If no nudge has passed yet (we're before the first nudge), currentNudgeNumber stays at 1

    return {
      currentNudgeNumber,
      totalNudges: nudgeTimes.length,
      nudgeTimes,
    };
  }

  /**
   * Calculate nudge context for hours_before_end mode
   * Returns { currentNudgeNumber, totalNudges } based on current UTC time
   */
  static calculateHoursBeforeEndContext(hoursBeforeArray: number[]): {
    currentNudgeNumber: number;
    totalNudges: number;
    nudgeTimes: { hour: number; minute: number; hoursBefore: number }[];
  } {
    const WAR_END_HOUR = 9;
    const WAR_END_MINUTE = 0;

    // Calculate all nudge times (war end - X hours)
    const nudgeTimes: { hour: number; minute: number; hoursBefore: number }[] = [];

    for (const hoursBefore of hoursBeforeArray) {
      const targetTotalMinutes = WAR_END_HOUR * 60 + WAR_END_MINUTE - hoursBefore * 60;
      let targetHour = Math.floor(targetTotalMinutes / 60);
      let targetMinute = targetTotalMinutes % 60;

      // Handle negative hours (wraps to previous day)
      if (targetHour < 0) {
        targetHour += 24;
      }

      // Handle negative minutes
      if (targetMinute < 0) {
        targetMinute += 60;
      }

      // Round to nearest whole minute
      targetMinute = Math.round(targetMinute);

      nudgeTimes.push({ hour: targetHour, minute: targetMinute, hoursBefore });
    }

    // Find which nudge we're currently at based on current UTC time
    const now = new Date();
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinute;

    let currentNudgeNumber = 1; // Default to first nudge

    // Find the most recent nudge time that has passed
    for (let i = nudgeTimes.length - 1; i >= 0; i--) {
      const nudgeTime = nudgeTimes[i];
      const nudgeTotalMinutes = nudgeTime.hour * 60 + nudgeTime.minute;

      // Check if this nudge time has passed
      // Handle wrap-around for nudges after midnight
      if (nudgeTotalMinutes <= currentTotalMinutes) {
        currentNudgeNumber = i + 1;
        break;
      }
    }

    return {
      currentNudgeNumber,
      totalNudges: nudgeTimes.length,
      nudgeTimes,
    };
  }

  /**
   * Get current UTC time info for display to users
   */
  static getServerTimeInfo(): { time: string; date: string; unix: number } {
    const now = new Date();
    return {
      time: `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`, // HH:MM:SS UTC
      date: now.toISOString().split('T')[0], // YYYY-MM-DD
      unix: Math.floor(now.getTime() / 1000), // Unix timestamp
    };
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info('Stopped nudge scheduler');
    }
  }

  private async checkScheduledTasks() {
    try {
      await this.checkPendingNudges();
    } catch (error) {
      logger.error('Error checking scheduled tasks:', error);
    }
  }

  /**
   * Check for nudges that should be sent now.
   * Logic:
   * - Only send during war days (race_state = 'warDay')
   * - Check if current time matches a scheduled nudge time
   * - Ensure we haven't already sent this nudge today
   */
  private async checkPendingNudges() {
    try {
      const now = new Date();
      const currentHour = now.getUTCHours();
      const currentMinute = now.getUTCMinutes();
      // Query clans with nudge settings enabled
      // Use DISTINCT ON per GUILD+CLAN since different guilds have different nudge settings for same clan
      // Get only the LATEST race per guild+clan (most recently created)
      const result = await pool.query<ScheduledNudge>(
        `
        SELECT DISTINCT ON (c.guild_id, c.clantag)
          rr.race_id,
          c.clantag,
          c.guild_id,
          c.clan_name,
          c.staff_channel_id,
          c.race_nudge_channel_id,
          c.nudge_method,
          c.race_nudge_start_hour,
          c.race_nudge_start_minute,
          c.race_nudge_interval_hours,
          c.race_nudge_hours_before_array,
          c.race_custom_nudge_message,
          rr.current_day,
          rr.current_week,
          rr.race_state,
          rr.end_time
        FROM river_races rr
        JOIN clans c ON c.clantag = rr.clantag
        WHERE c.nudge_method IN ('interval', 'hours_before_end')
          AND c.race_nudge_channel_id IS NOT NULL
          AND (
            (c.nudge_method = 'interval' AND c.race_nudge_start_hour IS NOT NULL AND c.race_nudge_start_minute IS NOT NULL)
            OR (c.nudge_method = 'hours_before_end' AND c.race_nudge_hours_before_array IS NOT NULL)
          )
        ORDER BY c.guild_id, c.clantag, rr.created_at DESC
        `,
      );

      for (const clan of result.rows) {
        await this.processNudgeForClan(clan, currentHour, currentMinute);
      }
    } catch (error) {
      logger.error('Error checking pending nudges:', error);
    }
  }

  private async processNudgeForClan(clan: ScheduledNudge, currentHour: number, currentMinute: number) {
    try {
      // Verify we're in war day or colosseum (not training day)
      if (clan.race_state !== 'warDay' && clan.race_state !== 'colosseum') {
        return;
      }

      let matchingNudgeIndex = -1;
      let totalNudges = 0;
      let timeString = '';

      if (clan.nudge_method === 'interval') {
        // Interval method: Check scheduled times
        const startHour = clan.race_nudge_start_hour!;
        const startMinute = clan.race_nudge_start_minute!;
        const intervalHours = clan.race_nudge_interval_hours!;

        // Calculate all nudge times and find current nudge number
        const nudgeContext = NudgeTrackingScheduler.calculateNudgeContext(startHour, startMinute, intervalHours);
        const { nudgeTimes } = nudgeContext;
        totalNudges = nudgeContext.totalNudges;

        // Find which nudge time matches current time (if any)
        matchingNudgeIndex = nudgeTimes.findIndex((time) => time.hour === currentHour && time.minute === currentMinute);

        if (matchingNudgeIndex === -1) {
          // Not time for a nudge yet
          return;
        }

        const matchingTime = nudgeTimes[matchingNudgeIndex];
        timeString = `${String(matchingTime.hour).padStart(2, '0')}:${String(matchingTime.minute).padStart(2, '0')}:00`;
      } else if (clan.nudge_method === 'hours_before_end') {
        // Hours before end method: Check if current time matches X hours before 9am UTC
        const hoursBeforeArray = clan.race_nudge_hours_before_array!;

        // Calculate all nudge times using shared method
        const nudgeContext = NudgeTrackingScheduler.calculateHoursBeforeEndContext(hoursBeforeArray);
        const { nudgeTimes } = nudgeContext;
        totalNudges = nudgeContext.totalNudges;

        // Find which nudge time matches current time (if any)
        matchingNudgeIndex = nudgeTimes.findIndex((time) => time.hour === currentHour && time.minute === currentMinute);

        if (matchingNudgeIndex === -1) {
          // Not time for a nudge yet
          return;
        }

        const matchingTime = nudgeTimes[matchingNudgeIndex];
        timeString = `${String(matchingTime.hour).padStart(2, '0')}:${String(matchingTime.minute).padStart(2, '0')}:00 (${matchingTime.hoursBefore}h before war end)`;
      } else {
        // Unknown method
        logger.info(`❌ Unknown nudge method for ${clan.clan_name}: ${clan.nudge_method}`);
        return;
      }

      // logger.info(`⏰ Scheduled nudge time ${timeString} UTC matched for ${clan.clan_name} - Checking dedupe...`);

      // Check if we already sent ANY nudge recently (prevents automatic nudges after manual ones)
      // Window is 60 minutes to avoid over-nudging
      let DEDUPE_WINDOW_MINUTES: number;
      if (isDev) {
        DEDUPE_WINDOW_MINUTES = 1;
      } else {
        DEDUPE_WINDOW_MINUTES = 60;
      }
      const existingNudge = await pool.query<{ nudge_time: Date; nudge_type: string }>(
        `
        SELECT nudge_time, nudge_type FROM race_nudges
        WHERE race_id = $1
          AND clantag = $2
          AND race_day = $3
          AND nudge_time >= NOW() - INTERVAL '${DEDUPE_WINDOW_MINUTES} minutes'
        ORDER BY nudge_time DESC
        LIMIT 1
        `,
        [clan.race_id, clan.clantag, clan.current_day],
      );

      if (existingNudge.rows.length > 0) {
        const lastNudge = existingNudge.rows[0];
        const lastSent = lastNudge.nudge_time;

        // logger.info(
        //   `⏭️  Skipping automatic nudge for ${clan.clan_name} at ${timeString} UTC - nudge already sent at ${lastSent} (within ${DEDUPE_WINDOW_MINUTES}min window)`,
        // );

        // Notify staff channel if we're skipping due to recent manual nudge
        await this.notifySkippedNudge(clan, lastSent, timeString, 'recent');

        return;
      }

      // Send the nudge!
      await NudgeTrackingScheduler.sendNudge(this.client, clan, false, matchingNudgeIndex + 1, totalNudges);
    } catch (error) {
      logger.error(`Error processing nudge for clan ${clan.clantag}:`, error);
    }
  }

  /**
   * Notify staff/log channel that automatic nudge was skipped
   */
  private async notifySkippedNudge(
    clan: ScheduledNudge,
    lastNudgeTime: Date,
    scheduledTime: string,
    reason: 'disabled' | 'recent' = 'recent',
  ) {
    try {
      // Try to fetch the staff channel to send notification there
      const channel = await this.client.channels
        .fetch(clan.staff_channel_id)
        .catch(() => console.warn('Staff channel not found for skip notification'));
      if (!channel?.isTextBased() || !(channel instanceof TextChannel)) {
        return; // Silently skip if channel not found
      }

      // Convert last nudge time to Unix timestamp for Discord
      const lastSentUnix = Math.floor(new Date(lastNudgeTime).getTime() / 1000);

      // Convert scheduled time (HH:MM:SS format) to Unix timestamp for today
      const [hour, minute] = scheduledTime.split(':').map(Number);
      const now = new Date();
      const scheduledDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0),
      );
      const scheduledUnix = Math.floor(scheduledDate.getTime() / 1000);

      let description: string;
      if (reason === 'disabled') {
        description = `ℹ️ **Scheduled nudge skipped** for ${clan.clan_name} at <t:${scheduledUnix}:f>\n-# Nudges are currently disabled for this clan`;
      } else {
        description = `ℹ️ **Scheduled nudge skipped** for ${clan.clan_name} at <t:${scheduledUnix}:f>\n-# A nudge was already sent at <t:${lastSentUnix}:t> (within 1 hour)`;
      }

      if (clan.end_time !== null) {
        description += `\nWar ends ~${getNextDayRelativeTimestamp(clan.end_time)}`;
      }
      await channel.send({
        content: description,
      });

      logger.info(`Sent skip notification for ${clan.clan_name} to channel ${clan.staff_channel_id}`);
    } catch (error) {
      logger.error(`Error sending skip notification for clan ${clan.clantag}:`, error);
    }
  }

  /**
   * Send a nudge for a clan. Shared by scheduler and manual /nudge command.
   * @param client Discord client
   * @param clan Clan data including race info and nudge settings
   * @param isManual Whether this is a manual nudge (true) or automatic (false)
   * @param currentNudgeNumber Current position in nudge sequence (1-based)
   * @param totalNudges Total number of nudges in sequence
   * @param senderId Optional Discord user ID who triggered manual nudge
   */
  static async sendNudge(
    client: Client,
    clan: ScheduledNudge,
    isManual: boolean = false,
    currentNudgeNumber?: number,
    totalNudges?: number,
    senderId?: string,
  ): Promise<void> {
    try {
      // Calculate nudge times based on nudge method
      let nudgeTimes: Array<{ hour: number; minute: number; hoursBefore?: number }> | undefined;

      if (
        clan.nudge_method === 'interval' &&
        clan.race_nudge_start_hour !== null &&
        clan.race_nudge_start_minute !== null &&
        clan.race_nudge_interval_hours !== null
      ) {
        const context = NudgeTrackingScheduler.calculateNudgeContext(
          clan.race_nudge_start_hour,
          clan.race_nudge_start_minute,
          clan.race_nudge_interval_hours,
        );
        nudgeTimes = context.nudgeTimes;
      } else if (
        clan.nudge_method === 'hours_before_end' &&
        clan.race_nudge_hours_before_array &&
        clan.race_nudge_hours_before_array.length > 0
      ) {
        const context = NudgeTrackingScheduler.calculateHoursBeforeEndContext(clan.race_nudge_hours_before_array);
        nudgeTimes = context.nudgeTimes;
      }

      // Fetch channel
      const channel = await client.channels.fetch(clan.race_nudge_channel_id);
      if (!channel?.isTextBased() || !(channel instanceof TextChannel)) {
        logger.warn(`Nudge channel ${clan.race_nudge_channel_id} not found or not text-based`);
        return;
      }

      // Delete previous automatic nudge message if this is an automatic nudge
      if (!isManual) {
        try {
          const previousNudge = await pool.query<{ message_id: string }>(
            `
            SELECT message_id FROM race_nudges
            WHERE race_id = $1
              AND clantag = $2
              AND race_day = $3
              AND nudge_type = 'automatic'
              AND message_id IS NOT NULL
            ORDER BY nudge_time DESC
            LIMIT 1
            `,
            [clan.race_id, clan.clantag, clan.current_day],
          );

          if (previousNudge.rows.length > 0) {
            const messageId = previousNudge.rows[0].message_id;
            logger.debug(
              `Found previous automatic nudge message ${messageId} for ${clan.clan_name}, attempting deletion...`,
            );
            try {
              // Try to fetch and delete the message
              const oldMessage = await channel.messages.fetch(messageId);
              await oldMessage.delete();
              logger.info(`Deleted previous auto-nudge message ${messageId} for ${clan.clan_name}`);
            } catch (deleteError) {
              // Message might already be deleted or not found - that's okay
              // Discord API error code 10008 = Unknown Message
              if (
                typeof deleteError === 'object' &&
                deleteError !== null &&
                'code' in deleteError &&
                deleteError.code !== 10008
              ) {
                const message = 'message' in deleteError ? String(deleteError.message) : 'Unknown error';
                logger.warn(`Could not delete previous nudge message ${messageId}: ${message}`);
              }
            }
          }
        } catch (error) {
          logger.error('Error checking/deleting previous nudge:', error);
        }
      }

      // Fetch guild
      logger.debug(`Fetching guild with ID: ${clan.guild_id} (type: ${typeof clan.guild_id})`);
      const guild = await client.guilds.fetch(clan.guild_id);
      if (!guild) {
        logger.warn(`Guild ${clan.guild_id} not found`);
        return;
      }

      // Defensive check - ensure we got a Guild object, not a Collection
      if (!guild.id || typeof guild.id !== 'string') {
        logger.error(`Invalid guild object received for ${clan.guild_id}:`, typeof guild);
        return;
      }

      logger.debug(`Successfully fetched guild: ${guild.id} (${guild.name})`);

      // Update race data from API before sending nudge
      const updateResult = await initializeOrUpdateRace(clan.clantag);
      if (!updateResult) {
        logger.warn(`Failed to update race data for ${clan.clantag}`);
        return;
      }

      const raceData = updateResult.raceData;
      const seasonId = updateResult.seasonId;
      const raceId = updateResult.raceId;
      const currentWeek = updateResult.warWeek;
      const currentDay = updateResult.warDay;

      // TODO uncomment when not testing
      // Check if it's training day after getting fresh race data
      if (raceData.periodType === 'training') {
        throw {
          name: 'training_day',
          embed: new EmbedBuilder().setDescription('Today is a training day. No Nudges').setColor(EmbedColor.FAIL),
        };
      }

      // Use existing getRaceAttacks service that handles all the logic
      const attacksData = await getRaceAttacks(guild.id, raceId, raceData, seasonId, currentWeek);

      if (!attacksData || attacksData.participants.length === 0) {
        logger.info(`No players to nudge for ${clan.clan_name}`);
        const completionMessage = `✅ All players have completed their attacks for ${clan.clan_name}!`;
        const message = await channel.send({
          content: completionMessage,
        });

        // Track as a nudge with no participants
        await trackNudge(
          raceId,
          clan.clantag,
          currentWeek,
          currentDay,
          isManual ? 'manual' : 'automatic',
          completionMessage,
          [], // Empty participants array
          message.id,
        );
        return;
      }

      // Get the nudge message with placeholders replaced
      let nudgeMessage = await getNudgeMessage(
        guild.id,
        clan.clantag,
        clan.clan_name,
        currentDay,
        clan.race_custom_nudge_message,
      );

      // Add sender info
      const sender = senderId || client.user?.id;
      nudgeMessage += ` (Sent by <@${sender}>)`;

      // Build nudge components using shared helper
      const nudgeComponents = await buildNudgeComponents(
        guild,
        attacksData,
        nudgeMessage,
        clan.race_nudge_channel_id,
        currentNudgeNumber,
        totalNudges,
        updateResult.endTime ?? undefined,
        nudgeTimes,
      );

      // TODO check what no nudge components actually does
      if (!nudgeComponents) {
        logger.info(`All players completed attacks for ${clan.clan_name}`);
        const completionMessage = `✅ All players have completed their attacks for ${clan.clan_name}!`;
        const message = await channel.send({
          content: completionMessage,
        });

        // Track as a nudge with no participants
        await trackNudge(
          raceId,
          clan.clantag,
          currentWeek,
          currentDay,
          isManual ? 'manual' : 'automatic',
          completionMessage,
          [], // Empty participants array
          message.id,
        );
        return;
      }

      // Send nudge with Components v2
      const message = await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: nudgeComponents.components,
      });

      // Track nudge using existing helper
      await trackNudge(
        raceId,
        clan.clantag,
        currentWeek,
        currentDay,
        isManual ? 'manual' : 'automatic',
        nudgeMessage,
        nudgeComponents.enrichedParticipants,
        message.id,
      );

      // Nudge sent successfully
    } catch (error: any) {
      // Re-throw training day errors so manual commands can handle them
      if (error?.name === 'training_day') {
        throw error;
      }

      // Log all other errors
      logger.error(`Error sending nudge for clan ${clan.clantag}:`, error);
    }
  }
}
