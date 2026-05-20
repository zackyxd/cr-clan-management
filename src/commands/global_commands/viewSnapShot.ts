import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { normalizeTag } from '../../api/CR_API.js';
import { pool } from '../../db.js';
import { buildRaceEmbed } from '../../features/race-tracking/embedBuilders.js';
import { RaceStatsData } from '../../features/race-tracking/types.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';
import { getDayForDisplay, periodTypeMap } from '../../features/race-tracking/service.js';
import { getNextDayRelativeTimestamp } from '../../features/race-tracking/timeUtils.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('view-snapshot')
    .setDescription('View a race for a specific clan and for season, week, and day.')
    .addStringOption((option) => option.setName('abbrev').setDescription('Clantag or abbreviation').setRequired(true))
    .addIntegerOption((option) =>
      option
        .setName('day')
        .setDescription('Race day number (1-4, where 1-4 are war days)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(4),
    )
    .addIntegerOption((option) =>
      option
        .setName('season')
        .setDescription('Season number. Defaults to current or latest season.')
        .setRequired(false)
        .setMinValue(1),
    )
    .addIntegerOption((option) =>
      option
        .setName('week')
        .setDescription('War week number (e.g. 1-5)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(5),
    ),
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply();
    const userInput = interaction.options.getString('abbrev') as string;
    const normalizedTag = normalizeTag(userInput);
    const clanRes = await pool.query(
      `SELECT clantag FROM clans WHERE guild_id = $1 AND (clantag = $2 OR LOWER(abbreviation) = LOWER($3))`,
      [guild.id, normalizedTag, userInput],
    );

    const fixedClantag = clanRes.rows.length > 0 ? clanRes.rows[0].clantag : normalizedTag;

    const day = interaction.options.getInteger('day') as number;
    let seasonId = interaction.options.getInteger('season');
    let week = interaction.options.getInteger('week');

    // Handle missing parameters by querying for the latest available data
    if (!seasonId || !week) {
      let query: string;
      let params: (string | number)[];

      if (!seasonId && !week) {
        // Neither provided: Get latest season + latest week in that season
        query = `
          SELECT season_id, current_week
          FROM river_races
          WHERE clantag = $1
          ORDER BY season_id DESC, current_week DESC
          LIMIT 1
        `;
        params = [fixedClantag];
      } else if (!seasonId) {
        // Week provided, season missing: Get latest season that has this week
        query = `
          SELECT season_id, current_week
          FROM river_races
          WHERE clantag = $1 AND current_week = $2
          ORDER BY season_id DESC
          LIMIT 1
        `;
        params = [fixedClantag, week];
      } else {
        // Season provided, week missing: Get latest week in that season
        query = `
          SELECT season_id, current_week
          FROM river_races
          WHERE clantag = $1 AND season_id = $2
          ORDER BY current_week DESC
          LIMIT 1
        `;
        params = [fixedClantag, seasonId];
      }

      const latestRes = await pool.query<{ season_id: number; current_week: number }>(query, params);

      if (latestRes.rows.length === 0) {
        await interaction.editReply(`❌ No race data found for clan ${fixedClantag}`);
        return;
      }

      seasonId = latestRes.rows[0].season_id;
      week = latestRes.rows[0].current_week;
    }

    const snapRes = await pool.query(
      `
      SELECT snapshot_data
      FROM race_day_snapshots rds
      JOIN river_races rr ON rds.race_id = rr.race_id
      WHERE rds.guild_id = $1 AND rr.clantag = $2 AND rr.season_id = $3 AND rr.current_week = $4 AND rds.race_day = $5
      ORDER BY rds.snapshot_time DESC
      LIMIT 1
      `,
      [guild.id, fixedClantag, seasonId, week, day],
    );

    if (snapRes.rows.length === 0) {
      await interaction.editReply(
        `❌ No snapshot found for ${fixedClantag} - Season ${seasonId}, Week ${week}, Day ${day}`,
      );
      return;
    }

    const snapshotData = snapRes.rows[0].snapshot_data;
    const { rawApiData, embedData } = snapshotData;

    // Reconstruct RaceStatsData from snapshot
    const raceStats: RaceStatsData = embedData.race as RaceStatsData;

    // Fix boat completion detection and sorting for warDay snapshots
    if (raceStats.type === 'warDay') {
      // Detect boat completion based on boatPoints
      for (const clan of raceStats.clans) {
        clan.isBoatCompleted = clan.boatPoints >= 10000;
      }

      // Re-sort: completed boats first, then by fame descending
      raceStats.clans.sort((a, b) => {
        // Completed boats always come first
        if (a.isBoatCompleted && !b.isBoatCompleted) return -1;
        if (!a.isBoatCompleted && b.isBoatCompleted) return 1;

        // Among completed boats or non-completed boats, sort by fame
        return b.fame - a.fame;
      });
    }

    // Get endTime from rawApiData if available
    const endTime = rawApiData?.endTime ? new Date(rawApiData.endTime) : null;

    // Build race standings embed using existing builder
    const raceEmbed = buildRaceEmbed(raceStats, fixedClantag, seasonId, week!, day, endTime);

    // Detect boat completion for attacks embed (in case older snapshots don't have the flag)
    let isBoatCompleted = embedData.attacks.isBoatCompleted;
    if (!isBoatCompleted && raceStats.type === 'warDay') {
      const ourClan = raceStats.clans.find((c) => c.clantag === fixedClantag);
      if (ourClan && ourClan.boatPoints >= 10000) {
        isBoatCompleted = true;
      }
    }

    // Build attacks embed from snapshot data - matching exact format of buildAttacksEmbed
    const attacksEmbed = new EmbedBuilder()
      .setTitle(`${embedData.attacks.clanName}`)
      .setAuthor({
        name: `Season ${seasonId ?? '---'} | Week ${week} | Day ${getDayForDisplay(day)}`,
      })
      .setColor(BOTCOLOR)
      .setURL(`https://cwstats.com/clan/${fixedClantag.substring(1)}/race`);

    // Build description matching the original format
    const periodType = rawApiData?.periodType || 'warDay';
    let description = '';

    // Handle boat completion differently - show who attacked
    if (isBoatCompleted) {
      description = `🏁\n`;

      // Check if we have groups data
      if (!embedData.attacks.groups || embedData.attacks.groups.length === 0) {
        // Fallback if groups is empty
        description += `**Boat completed!**\n\n`;
        description += `_No detailed attack data available in this snapshot._`;
      } else {
        const totalPlayers = embedData.attacks.groups.reduce((sum: number, g: { count: number }) => sum + g.count, 0);
        description += `**${totalPlayers} players attacked today**\n\n`;

        // Display groups (already sorted by attacks used)
        for (let i = 0; i < embedData.attacks.groups.length; i++) {
          const group = embedData.attacks.groups[i];

          // Add blank line between groups (if not first)
          if (i > 0) description += '\n';

          // For boat completion, attacksRemaining actually represents attacks used
          description += `__**${group.attacksRemaining} Attack${group.attacksRemaining !== 1 ? 's' : ''} (${group.count})**__\n`;

          // Add each player
          for (const player of group.players) {
            const emojis = player.emojis.length > 0 ? ' ' + player.emojis.join(' ') : '';
            description += `${player.name}${emojis}\n`;
          }
        }

        // Calculate total attacks used (attacksRemaining field is actually attacks used for boat completion)
        const totalAttacksUsed = embedData.attacks.groups.reduce(
          (sum: number, g: { attacksRemaining: number; count: number }) => sum + g.attacksRemaining * g.count,
          0,
        );

        // Add summary line showing who attacked (instead of who's remaining)
        description += `\n:playersLeft: ${totalPlayers}\n:attacksLeft: ${totalAttacksUsed}`;
      }
    } else {
      // Normal attacks remaining display
      description = `## ${periodTypeMap[periodType] || ''} Attacks\n`;

      // Check if all attacks completed
      if (embedData.attacks.totalAttacksRemaining === 0 || embedData.attacks.groups.length === 0) {
        description += '✅ Everyone has completed their attacks!';
        if (endTime) {
          description += `\n\n-# War ends ~${getNextDayRelativeTimestamp(endTime)}`;
        }
      } else {
        const lines: string[] = [];

        // Format groups matching formatParticipantsList output
        for (let i = 0; i < embedData.attacks.groups.length; i++) {
          const group = embedData.attacks.groups[i];

          // Add blank line between groups (if not first)
          if (i > 0) lines.push('');

          // Add group header
          lines.push(
            `__**${group.attacksRemaining} Attack${group.attacksRemaining !== 1 ? 's' : ''} (${group.count})**__`,
          );

          // Add each player
          for (const player of group.players) {
            const emojis = player.emojis.length > 0 ? ' ' + player.emojis.join(' ') : '';
            lines.push(`${player.name}${emojis}`);
          }
        }

        // Add summary line at the end (matching original format)
        lines.push(
          `\n:playersLeft: ${embedData.attacks.availableAttackers}\n:attacksLeft: ${embedData.attacks.totalAttacksRemaining}`,
        );

        description += lines.join('\n');

        if (endTime) {
          description += `\n\n-# War ends ~${getNextDayRelativeTimestamp(endTime)}`;
        }
      }
    }

    attacksEmbed.setDescription(description);

    // Add footer
    if (!embedData.attacks.isBoatCompleted && embedData.attacks.legend && embedData.attacks.legend.length > 0) {
      const footer = embedData.attacks.legend.join('\n') + '\n-# (Snapshot from end of day)';
      attacksEmbed.setFooter({ text: footer });
    } else {
      attacksEmbed.setFooter({ text: '-# (Snapshot from end of day)' });
    }

    await interaction.editReply({
      embeds: [raceEmbed, attacksEmbed],
    });
  },
};

export default command;
