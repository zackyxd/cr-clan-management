/**
 * Time utilities for race tracking scheduler
 * All times are in server time (UTC)
 */

/**
 * Get current server time formatted for display
 */
export function getServerTimeDisplay(): string {
  const now = new Date();
  const time = now.toTimeString().split(' ')[0]; // HH:MM:SS
  const date = now.toISOString().split('T')[0]; // YYYY-MM-DD

  return `**${time}** on ${date} (Server Time)`;
}

/**
 * Get Discord timestamp for current time
 */
export function getCurrentTimestamp(): string {
  const unix = Math.floor(Date.now() / 1000);
  return `<t:${unix}:T>`; // Shows in user's local timezone automatically
}

export function getNextDayRelativeTimestamp(date: Date): string {
  const unix = Math.floor(date.getTime() / 1000) + 86400;
  return `<t:${unix}:R>`; // Relative time (e.g., "in 5 minutes", "2 hours ago")
}

/**
 * Format time input (HH:MM or HH:MM:SS) to database format
 */
export function parseTimeInput(input: string): { hour: number; minute: number; formatted: string } | null {
  const patterns = [
    /^(\d{1,2}):(\d{2})$/, // "10:00"
    /^(\d{1,2}):(\d{2}):(\d{2})$/, // "10:00:00"
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      const hour = parseInt(match[1]);
      const minute = parseInt(match[2]);

      // Validate
      if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
        const formatted = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
        return { hour, minute, formatted };
      }
    }
  }

  return null;
}

/**
 * Format time for display (no AM/PM, just 24-hour)
 */
export function formatTime24(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Calculate all nudge times based on start time and interval
 * Nudges automatically stop at 9:00am UTC (hardcoded)
 * Handles midnight wrap-around (e.g., start at 18:00, stop at 09:00)
 *
 * Examples:
 *   Start: 1am, Interval: 2h -> 1am, 3am, 5am, 7am, 9am
 *   Start: 6pm, Interval: 2h -> 6pm, 8pm, 10pm, 12am, 2am, 4am, 6am, 8am
 */
export function calculateNudgeTimes(
  startHour: number,
  startMinute: number,
  intervalHours: number,
): Array<{ hour: number; minute: number; display: string }> {
  const times: Array<{ hour: number; minute: number; display: string }> = [];
  const startTotalMinutes = startHour * 60 + startMinute;

  // Hardcoded stop time: 9:00am UTC
  const STOP_HOUR = 9;
  const STOP_MINUTE = 0;
  const stopTotalMinutes = STOP_HOUR * 60 + STOP_MINUTE; // 540 minutes
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

    times.push({
      hour,
      minute,
      display: formatTime24(hour, minute),
    });

    i++;
  }

  return times;
}

/**
 * Create Discord timestamps for nudge times (shows in user's local timezone)
 * Automatically stops at 9:00am UTC (hardcoded)
 * Returns array of formatted <t:unix:t> strings
 */
export function createScheduleTimestamps(startHour: number, startMinute: number, intervalHours: number): string[] {
  const times = calculateNudgeTimes(startHour, startMinute, intervalHours);
  const now = new Date();

  return times.map((time) => {
    // Create UTC timestamp for today at this time
    const timestamp = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), time.hour, time.minute, 0),
    );

    const unix = Math.floor(timestamp.getTime() / 1000);
    return `<t:${unix}:t>`; // Shows in user's local timezone!
  });
}
