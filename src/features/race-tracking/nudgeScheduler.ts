import { Client, TextChannel, MessageFlags } from 'discord.js';
import { pool } from '../../db.js';
import logger from '../../logger.js';
import { getRaceAttacks } from './service.js';
import { trackNudge, getNudgeMessage, buildNudgeComponents } from './nudgeHelper.js';
import { isDev } from '../../utils/env.js';

interface ScheduledNudge {
  race_id: number;
  clantag: string;
  guild_id: string;
  clan_name: string;
  staff_channel_id: string;
  race_nudge_channel_id: string;
  race_nudge_start_hour: number; // 0-23 (UTC)
  race_nudge_start_minute: number; // 0-59 (UTC)
  race_nudge_interval_hours: number;
  race_custom_nudge_message: string | null;
  current_day: number;
  current_week: number;
  race_state: string;
}

/**
 *
 * Race Tracking Scheduler
 * Handles automatic nudge sending at scheduled times.
 *
 */

export class RaceTrackingScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL: number;

  constructor(private client: Client) {
    // Configurable check interval (default: 60 seconds)
    // For testing: set RACE_SCHEDULER_INTERVAL_SECONDS=10 in .env.dev
    const intervalSeconds = process.env.RACE_SCHEDULER_INTERVAL_SECONDS
      ? parseInt(process.env.RACE_SCHEDULER_INTERVAL_SECONDS)
      : 60;

    this.CHECK_INTERVAL = intervalSeconds * 1000;
    logger.info(`Race scheduler will check every ${intervalSeconds} seconds`);
  }

  start() {
    if (this.intervalId) return;
    logger.info('Starting race tracking scheduler');
    this.intervalId = setInterval(() => this.checkScheduledTasks(), this.CHECK_INTERVAL);

    // Run on startup
    this.checkScheduledTasks();
  }

  /**
   * Manually trigger a nudge immediately for a specific clan (for testing/manual sends)
   */
  async triggerNudgeNow(guildId: string, clantag: string): Promise<{ success: boolean; message: string }> {
    try {
      const result = await pool.query<ScheduledNudge>(
        `
        SELECT 
          rr.race_id,
          c.clantag,
          c.guild_id,
          c.clan_name,
          c.staff_channel_id,
          c.race_nudge_channel_id,
          c.race_nudge_start_hour,
          c.race_nudge_start_minute,
          c.race_nudge_interval_hours,
          c.race_custom_nudge_message,
          rr.current_day,
          rr.current_week,
          rr.race_state
        FROM river_races rr
        JOIN clans c ON c.clantag = rr.clantag AND c.guild_id = rr.guild_id
        WHERE c.guild_id = $1 AND c.clantag = $2
          AND rr.race_state = 'warDay'
          AND c.race_nudge_channel_id IS NOT NULL
        `,
        [guildId, clantag],
      );

      if (result.rows.length === 0) {
        return { success: false, message: 'No active race or nudge settings not configured' };
      }

      const clan = result.rows[0];
      await this.sendNudge(clan, true); // Pass true for manual trigger
      return { success: true, message: `Nudge sent to ${clan.clan_name}` };
    } catch (error) {
      logger.error('Error triggering manual nudge:', error);
      return { success: false, message: 'Failed to send nudge' };
    }
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
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Stopped race tracking scheduler');
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
      console.log(
        `⏰ Checking for pending nudges at ${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')} UTC`,
      );
      // Query clans with active races that have nudge settings
      const result = await pool.query<ScheduledNudge>(
        `
        SELECT 
          rr.race_id,
          c.clantag,
          c.guild_id,
          c.clan_name,
          c.staff_channel_id,
          c.race_nudge_channel_id,
          c.race_nudge_start_hour,
          c.race_nudge_start_minute,
          c.race_nudge_interval_hours,
          c.race_custom_nudge_message,
          rr.current_day,
          rr.current_week,
          rr.race_state
        FROM river_races rr
        JOIN clans c ON c.clantag = rr.clantag AND c.guild_id = rr.guild_id
        WHERE (rr.race_state = 'warDay' OR rr.race_state = 'training')
          AND c.race_nudge_channel_id IS NOT NULL
          AND c.race_nudge_start_hour IS NOT NULL
          AND c.race_nudge_start_minute IS NOT NULL
          -- AND rr.current_day > 0
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
      const startHour = clan.race_nudge_start_hour;
      const startMinute = clan.race_nudge_start_minute;
      const intervalHours = clan.race_nudge_interval_hours;

      // Hardcoded stop time: 9:00am UTC
      const STOP_HOUR = 9;
      const STOP_MINUTE = 0;
      const stopTotalMinutes = STOP_HOUR * 60 + STOP_MINUTE; // 540 minutes (9am)

      // Calculate all nudge times up to 9am UTC (handles midnight wrap-around)
      const nudgeTimes: { hour: number; minute: number }[] = [];
      const startTotalMinutes = startHour * 60 + startMinute;
      const crossesMidnight = startTotalMinutes >= stopTotalMinutes;

      let i = 0;
      while (true) {
        const totalMinutes = startTotalMinutes + i * intervalHours * 60;
        const hour = Math.floor(totalMinutes / 60) % 24;
        const minute = totalMinutes % 60;
        const currentMinutes = hour * 60 + minute; // Normalized to 0-1439

        // Check if we should stop
        if (crossesMidnight) {
          // Start time is after stop time (e.g., 18:00 start, 09:00 stop)
          // Stop when we're in the "gap" between stop and start
          // Example: If start=18:00, stop=09:00, stop when time is > 09:00 AND < 18:00
          if (currentMinutes > stopTotalMinutes && currentMinutes < startTotalMinutes) {
            break;
          }
        } else {
          // Start time is before stop time (e.g., 01:00 start, 09:00 stop)
          // Stop when we're past the stop time
          if (currentMinutes > stopTotalMinutes) {
            break;
          }
        }

        nudgeTimes.push({ hour, minute });
        i++;
      }

      // Find which nudge time matches current time (if any)
      const matchingNudgeIndex = nudgeTimes.findIndex(
        (time) => time.hour === currentHour && time.minute === currentMinute,
      );

      if (matchingNudgeIndex === -1) {
        // Not time for a nudge yet
        return;
      }

      const matchingTime = nudgeTimes[matchingNudgeIndex];
      const timeString = `${String(matchingTime.hour).padStart(2, '0')}:${String(matchingTime.minute).padStart(2, '0')}:00`;

      logger.debug(`⏰ Scheduled nudge time ${timeString} UTC matched for ${clan.clan_name}`);

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

        logger.info(
          `⏭️  Skipping automatic nudge for ${clan.clan_name} at ${timeString} UTC - nudge already sent at ${lastSent} (within ${DEDUPE_WINDOW_MINUTES}min window)`,
        );

        // Notify staff channel if we're skipping due to recent manual nudge
        await this.notifySkippedNudge(clan, lastSent, timeString);

        return;
      }

      // Send the nudge!
      await this.sendNudge(clan, false);
    } catch (error) {
      logger.error(`Error processing nudge for clan ${clan.clantag}:`, error);
    }
  }

  /**
   * Notify staff/log channel that automatic nudge was skipped due to recent manual nudge
   */
  private async notifySkippedNudge(clan: ScheduledNudge, lastNudgeTime: Date, scheduledTime: string) {
    try {
      // Try to fetch the nudge channel to send notification there
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

      await channel.send({
        content: `ℹ️ **Scheduled nudge skipped** for ${clan.clan_name} at <t:${scheduledUnix}:f>\n-# A nudge was already sent at <t:${lastSentUnix}:t> (within 1 hour)`,
      });

      logger.info(`Sent skip notification for ${clan.clan_name} to channel ${clan.staff_channel_id}`);
    } catch (error) {
      logger.error(`Error sending skip notification for clan ${clan.clantag}:`, error);
    }
  }

  private async sendNudge(clan: ScheduledNudge, isManual: boolean = false) {
    try {
      // Fetch channel
      const channel = await this.client.channels.fetch(clan.race_nudge_channel_id);
      if (!channel?.isTextBased() || !(channel instanceof TextChannel)) {
        logger.warn(`Nudge channel ${clan.race_nudge_channel_id} not found or not text-based`);
        return;
      }

      // Fetch guild
      const guild = await this.client.guilds.fetch(clan.guild_id);
      if (!guild) {
        logger.warn(`Guild ${clan.guild_id} not found`);
        return;
      }

      // Get race data and attacks info using existing service
      const raceResult = await pool.query(`SELECT current_data, season_id FROM river_races WHERE race_id = $1`, [
        clan.race_id,
      ]);

      if (!raceResult.rows[0]?.current_data) {
        logger.warn(`No race data found for race_id ${clan.race_id}`);
        return;
      }

      const raceData = raceResult.rows[0].current_data;
      const seasonId = raceResult.rows[0].season_id;

      // Use existing getRaceAttacks service that handles all the logic
      const attacksData = await getRaceAttacks(clan.guild_id, clan.race_id, raceData, seasonId, clan.current_week);

      if (!attacksData || attacksData.participants.length === 0) {
        logger.info(`No players to nudge for ${clan.clan_name}`);
        if (isManual) {
          await channel.send({
            content: `✅ All players have completed their attacks for ${clan.clan_name}!`,
          });
        }
        return;
      }

      // Get the nudge message with placeholders replaced
      const message =
        (await getNudgeMessage(
          clan.guild_id,
          clan.clantag,
          clan.clan_name,
          clan.current_day,
          clan.race_custom_nudge_message,
        )) + ` (Sent by <@${this.client.user?.id}>)`;

      // Build nudge components using shared helper
      const nudgeComponents = await buildNudgeComponents(guild, attacksData, message, clan.race_nudge_channel_id);

      if (!nudgeComponents) {
        logger.info(`All players completed attacks for ${clan.clan_name}`);
        if (isManual) {
          await channel.send({
            content: `✅ All players have completed their attacks for ${clan.clan_name}!`,
          });
        }
        return;
      }

      // Send nudge with Components v2
      await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: nudgeComponents.components,
      });

      // Track nudge using existing helper
      await trackNudge(
        clan.race_id,
        clan.clantag,
        clan.current_week,
        clan.current_day,
        isManual ? 'manual' : 'automatic',
        message,
        nudgeComponents.enrichedParticipants,
      );

      logger.info(
        `Sent ${isManual ? 'manual' : 'automatic'} nudge for ${clan.clan_name} (${nudgeComponents.enrichedParticipants.length} players)`,
      );
    } catch (error) {
      logger.error(`Error sending nudge for clan ${clan.clantag}:`, error);
    }
  }
}
