import { ButtonInteraction, MessageFlags } from 'discord.js';
import { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { pool } from '../../db.js';
import { Timer } from '../../utils/timing.js';
import { NudgeTrackingScheduler } from './nudgeScheduler.js';
import { postRacePingsToChannels } from './service.js';
import logger from '../../logger.js';

export class RaceTrackingInteractionRouter {
  static async handleButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action } = parsed;

    if (action === 'nudgeAttackingLate') {
      await this.handleNudgeAttackingLate(interaction, parsed);
    } else if (action === 'nudgeReplaceMe') {
      await this.handleNudgeReplaceMe(interaction, parsed);
    } else {
      await interaction.reply({ content: 'Unknown button for race tracking.', flags: MessageFlags.Ephemeral });
    }
  }

  private static async handleNudgeReplaceMe(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = parsed.guildId;
    const discordId = interaction.user.id;

    try {
      // Get current replace_me status and links
      const selectRes = await pool.query(
        `
        SELECT 
          u.is_replace_me,
          u.replace_me_ping_sent_today,
          up.playertag,
          up.current_username
        FROM users u
        LEFT JOIN user_playertags up ON u.guild_id = up.guild_id AND u.discord_id = up.discord_id
        WHERE u.guild_id = $1 AND u.discord_id = $2
        `,
        [guildId, discordId],
      );

      if (selectRes.rows.length === 0) {
        await interaction.editReply({
          content: 'You do not have any linked accounts in this server.',
        });
        return;
      }

      const currentStatus = selectRes.rows[0].is_replace_me;
      const newStatus = !currentStatus;

      // Check if a message was already sent today
      const alreadySentToday = selectRes.rows[0].replace_me_ping_sent_today || false;

      // Toggle is_replace_me and update flag if sending message
      await pool.query(
        `
        UPDATE users 
        SET is_replace_me = $3${newStatus && !alreadySentToday ? ', replace_me_ping_sent_today = true' : ''}
        WHERE guild_id = $1 AND discord_id = $2
        `,
        [guildId, discordId, newStatus],
      );

      if (newStatus) {
        await interaction.editReply({
          content: `✅ **You are now marked as "Replace Me"** and accounts have been posted to staff channel.\n\nYou will be excluded from nudges and will be listed as needing a replacement.\n\n**If possible**\n* Leave a message why you need replacement\n * Leave the clan to make room for a replacement.`,
        });
        // Only send ping message if not already sent today
        if (!alreadySentToday) {
          const playertags = selectRes.rows.map((row) => row.playertag).filter((tag) => tag);
          postRacePingsToChannels(guildId, playertags, 'replace').catch((err) =>
            console.error('Error posting race pings after toggling replace me:', err),
          );
        }
      } else {
        await interaction.editReply({
          content: `❌ **You are no longer marked as "Replace Me"**.\n\nYou will now receive nudges as normal and will not be listed as needing a replacement.`,
        });
      }
    } catch (error) {
      logger.error('Error toggling replace_me:', error);
      await interaction.editReply({
        content: '❌ An error occurred while updating your Replace Me status.',
      });
    }
  }

  private static async handleNudgeAttackingLate(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const timer = new Timer('attack-late button');

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = parsed.guildId;
    const discordId = interaction.user.id;

    try {
      // Get current is_attacking_late status and linked players
      const selectRes = await pool.query(
        `
        SELECT 
          u.is_attacking_late,
          u.attacking_late_ping_sent_today,
          up.playertag,
          up.current_username
        FROM users u
        LEFT JOIN user_playertags up ON u.guild_id = up.guild_id AND u.discord_id = up.discord_id
        WHERE u.guild_id = $1 AND u.discord_id = $2
        `,
        [guildId, discordId],
      );

      if (selectRes.rows.length === 0) {
        await interaction.editReply({
          content: 'You do not have any linked accounts in this server.',
        });
        return;
      }

      const currentStatus = selectRes.rows[0].is_attacking_late;
      const newStatus = !currentStatus;

      // Check if a message was already sent today
      const alreadySentToday = selectRes.rows[0].attacking_late_ping_sent_today || false;

      // Toggle is_attacking_late and update flag if sending message
      await pool.query(
        `
        UPDATE users 
        SET is_attacking_late = $3${newStatus && !alreadySentToday ? ', attacking_late_ping_sent_today = true' : ''}
        WHERE guild_id = $1 AND discord_id = $2
        `,
        [guildId, discordId, newStatus],
      );

      // Get clan nudge settings to show when they'll be nudged
      let nextNudgeInfo = '';
      if (newStatus) {
        try {
          const clanRes = await pool.query(
            `SELECT 
              clan_name,
              nudge_method, 
              race_nudge_start_hour, 
              race_nudge_start_minute, 
              race_nudge_interval_hours,
              race_nudge_hours_before_array
             FROM clans 
             WHERE guild_id = $1
             LIMIT 1`,
            [guildId],
          );

          if (clanRes.rows.length > 0) {
            const clan = clanRes.rows[0];
            const nudgeMethod = clan.nudge_method;

            if (
              nudgeMethod === 'interval' &&
              clan.race_nudge_start_hour !== null &&
              clan.race_nudge_start_minute !== null &&
              clan.race_nudge_interval_hours !== null
            ) {
              const context = NudgeTrackingScheduler.calculateNudgeContext(
                clan.race_nudge_start_hour,
                clan.race_nudge_start_minute,
                clan.race_nudge_interval_hours,
              );

              if (context.totalNudges > 1) {
                const skipCount = Math.ceil(context.totalNudges / 2);
                const nextFullNudge = skipCount + 1;
                const nextNudgeTime = context.nudgeTimes[nextFullNudge - 1];

                if (nextNudgeTime) {
                  // Calculate Unix timestamp for the next occurrence of this time
                  const now = new Date();
                  const nextDate = new Date(
                    Date.UTC(
                      now.getUTCFullYear(),
                      now.getUTCMonth(),
                      now.getUTCDate(),
                      nextNudgeTime.hour,
                      nextNudgeTime.minute,
                      0,
                    ),
                  );

                  // If the time has already passed today, add a day
                  if (nextDate.getTime() < now.getTime()) {
                    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
                  }

                  const unixTimestamp = Math.floor(nextDate.getTime() / 1000);
                  nextNudgeInfo = `\n\n-# All members for ${clan.clan_name} will receive nudges at <t:${unixTimestamp}:t>`;
                }
              } else {
                nextNudgeInfo = `\n\n-# All members for ${clan.clan_name} will still be pinged (only 1 nudge is configured)`;
              }
            } else if (
              nudgeMethod === 'hours_before_end' &&
              clan.race_nudge_hours_before_array &&
              clan.race_nudge_hours_before_array.length > 0
            ) {
              const context = NudgeTrackingScheduler.calculateHoursBeforeEndContext(clan.race_nudge_hours_before_array);

              if (context.totalNudges > 1) {
                const skipCount = Math.ceil(context.totalNudges / 2);
                const nextFullNudge = skipCount + 1;
                const nextNudgeTime = context.nudgeTimes[nextFullNudge - 1];

                if (nextNudgeTime) {
                  // Calculate Unix timestamp for the next occurrence of this time
                  const now = new Date();
                  const nextDate = new Date(
                    Date.UTC(
                      now.getUTCFullYear(),
                      now.getUTCMonth(),
                      now.getUTCDate(),
                      nextNudgeTime.hour,
                      nextNudgeTime.minute,
                      0,
                    ),
                  );

                  // If the time has already passed today, add a day
                  if (nextDate.getTime() < now.getTime()) {
                    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
                  }

                  const unixTimestamp = Math.floor(nextDate.getTime() / 1000);
                  nextNudgeInfo = `\n\n-# All members for ${clan.clan_name} will receive nudges at <t:${unixTimestamp}:t>`;
                }
              } else {
                nextNudgeInfo = `\n\n-# All members for ${clan.clan_name} will still be pinged (only 1 nudge is configured)`;
              }
            }
          }
        } catch (error) {
          console.error('Error fetching clan nudge settings:', error);
          // Continue without the nudge info
        }
      }

      if (newStatus) {
        await interaction.editReply({
          content: `✅ **You are now marked as attacking late**.\n\nYou will be excluded from the first half of attack reminders. ${nextNudgeInfo}`,
        });
        // Only send ping message if not already sent today
        if (!alreadySentToday) {
          const playertags = selectRes.rows.map((row) => row.playertag).filter((tag) => tag);
          postRacePingsToChannels(guildId, playertags, 'late').catch((err) =>
            console.error('Error posting race pings after toggling attacking late:', err),
          );
        }
      } else {
        await interaction.editReply({
          content: `❌ **You are no longer marked as attacking late**.\n\nYou will now receive all attack reminders.`,
        });
      }

      timer.end();
    } catch (error) {
      timer.end();
      console.error('Error toggling is_attacking_late:', error);
      await interaction.editReply({
        content: '❌ An error occurred while updating your attacking late status.',
      });
    }
  }
}
