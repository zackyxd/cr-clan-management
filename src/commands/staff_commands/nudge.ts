import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { Command } from '../../types/Command.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { normalizeTag } from '../../api/CR_API.js';
import { pool } from '../../db.js';
import { NudgeTrackingScheduler } from '../../features/race-tracking/nudgeScheduler.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('nudge')
    .setDescription('Send a nudge to all members with attacks remaining in a clan')
    .addStringOption((option) => option.setName('clantag').setDescription('#ABC123').setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    // const userId = interaction.user.id;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;

    const userInput = interaction.options.getString('clantag') as string;
    const normalizedTag = normalizeTag(userInput);

    // Query clan data and race info
    const clanRes = await pool.query(
      `SELECT 
        c.guild_id,
        c.clantag, 
        c.clan_name, 
        c.nudge_method, 
        c.race_custom_nudge_message, 
        c.race_nudge_channel_id,
        c.staff_channel_id,
        c.race_nudge_start_hour, 
        c.race_nudge_start_minute, 
        c.race_nudge_interval_hours,
        c.race_nudge_hours_before_array,
        rr.race_id,
        rr.current_day,
        rr.current_week,
        rr.race_state,
        rr.end_time
       FROM clans c
       LEFT JOIN river_races rr ON c.clantag = rr.clantag 
         AND rr.race_state IN ('warDay', 'colosseum')
       WHERE c.guild_id = $1 
         AND (c.clantag = $2 OR LOWER(c.abbreviation) = LOWER($3))`,
      [guild.id, normalizedTag, userInput],
    );

    if (clanRes.rows.length === 0) {
      await interaction.editReply({
        content: `❌ Clan not found. Make sure it's added to your server with \`/add-clan\`.`,
      });
      return;
    }

    const clanData = clanRes.rows[0];

    if (clanData.nudge_method === 'disabled') {
      await interaction.editReply({
        content: `❌ Nudges are disabled for this clan. Enable them in \`/clan-settings\`.`,
      });
      return;
    }

    if (!clanData.race_nudge_channel_id) {
      await interaction.editReply({
        content: `❌ No nudge channel configured for this clan. Set one in \`/clan-settings\`.`,
      });
      return;
    }

    // sendNudge() will call initializeOrUpdateRace() internally, so we just need to pass clan data
    const scheduledNudge = clanData;

    // Calculate nudge context based on schedule
    let currentNudgeNumber: number | undefined;
    let totalNudges: number | undefined;

    if (scheduledNudge.nudge_method === 'interval') {
      if (
        scheduledNudge.race_nudge_start_hour !== null &&
        scheduledNudge.race_nudge_start_minute !== null &&
        scheduledNudge.race_nudge_interval_hours !== null
      ) {
        const nudgeContext = NudgeTrackingScheduler.calculateNudgeContext(
          scheduledNudge.race_nudge_start_hour,
          scheduledNudge.race_nudge_start_minute,
          scheduledNudge.race_nudge_interval_hours,
        );
        currentNudgeNumber = nudgeContext.currentNudgeNumber;
        totalNudges = nudgeContext.totalNudges;
      }
    } else if (scheduledNudge.nudge_method === 'hours_before_end') {
      if (scheduledNudge.race_nudge_hours_before_array && scheduledNudge.race_nudge_hours_before_array.length > 0) {
        const nudgeContext = NudgeTrackingScheduler.calculateHoursBeforeEndContext(
          scheduledNudge.race_nudge_hours_before_array,
        );
        currentNudgeNumber = nudgeContext.currentNudgeNumber;
        totalNudges = nudgeContext.totalNudges;
      }
    }

    // Use shared sendNudge method from scheduler
    try {
      await NudgeTrackingScheduler.sendNudge(
        interaction.client,
        scheduledNudge,
        true,
        currentNudgeNumber,
        totalNudges,
        interaction.user.id,
      );
      await interaction.editReply(`✅ Nudge sent to <#${scheduledNudge.race_nudge_channel_id}>!`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      // Handle training day error specifically
      if (error?.name === 'training_day' && error?.embed) {
        await interaction.editReply({ embeds: [error.embed] });
        return;
      }

      // Handle all other errors
      console.error('Error sending nudge:', error);
      await interaction.editReply('❌ Failed to send nudge. Check bot permissions and channel configuration.');
    }
  },
};

export default command;
