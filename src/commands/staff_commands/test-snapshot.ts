import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { pool } from '../../db.js';
import { createDaySnapshot } from '../../features/race-tracking/service.js';
import { Command } from '../../types/Command.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('test-snapshot')
    .setDescription('[Test] Manually create a race day snapshot')
    .addStringOption((option) =>
      option.setName('clantag').setDescription('Clan tag (with or without #)').setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('day')
        .setDescription('Race day to snapshot (0-4)')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(4),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const clantagInput = interaction.options.getString('clantag', true);
    const clantag = clantagInput.startsWith('#') ? clantagInput : `#${clantagInput}`;
    const guildId = interaction.guildId!;

    try {
      // Get current race for this clan
      const raceQuery = await pool.query(
        `SELECT race_id, current_day, current_data, season_id, current_week, clan_name 
       FROM river_races 
       WHERE guild_id = $1 AND clantag = $2 
       ORDER BY created_at DESC 
       LIMIT 1`,
        [guildId, clantag],
      );

      if (raceQuery.rows.length === 0) {
        await interaction.editReply({
          content: `❌ No active race found for clan ${clantag}. Run \`/attacks\` first to initialize.`,
        });
        return;
      }

      const race = raceQuery.rows[0];
      const dayToSnapshot = interaction.options.getInteger('day') ?? race.current_day;

      // Check if snapshot already exists
      const existingSnapshot = await pool.query(
        `SELECT snapshot_id FROM race_day_snapshots WHERE race_id = $1 AND race_day = $2`,
        [race.race_id, dayToSnapshot],
      );

      if (existingSnapshot.rows.length > 0) {
        await interaction.editReply({
          content: `⚠️ Snapshot already exists for **${race.clan_name}** Day ${dayToSnapshot}.\n\nUse \`/view-snapshot\` to inspect it.`,
        });
        return;
      }

      // Create snapshot with current race data
      const success = await createDaySnapshot(
        race.race_id,
        guildId,
        race.current_data,
        race.season_id,
        race.current_week,
        dayToSnapshot,
      );

      if (success) {
        // Get snapshot details
        const snapshotQuery = await pool.query(
          `SELECT snapshot_id, snapshot_time, snapshot_data 
         FROM race_day_snapshots 
         WHERE race_id = $1 AND race_day = $2`,
          [race.race_id, dayToSnapshot],
        );

        const snapshot = snapshotQuery.rows[0];
        // JSONB columns are auto-parsed by pg, no need to JSON.parse
        const snapshotData = snapshot.snapshot_data;
        const attacks = snapshotData.embedData.attacks; // Access nested embedData

        const totalPlayers = attacks.groups.reduce((sum: number, g: any) => sum + g.count, 0);
        const splitAttackers = attacks.legend.filter((l: string) => l.includes('Split')).length > 0 ? 'Yes' : 'No';

        const embed = new EmbedBuilder()
          .setTitle(`✅ Snapshot Created`)
          .setDescription(`**${race.clan_name}** - Day ${dayToSnapshot}`)
          .setColor(0x00ff00)
          .addFields(
            { name: 'Snapshot ID', value: `${snapshot.snapshot_id}`, inline: true },
            {
              name: 'Timestamp',
              value: `<t:${Math.floor(new Date(snapshot.snapshot_time).getTime() / 1000)}:F>`,
              inline: false,
            },
            { name: 'Players Shown', value: `${totalPlayers}`, inline: true },
            { name: 'Attack Groups', value: `${attacks.groups.length}`, inline: true },
            { name: 'Available Attackers', value: `${attacks.availableAttackers}`, inline: true },
          );

        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply({
          content: `❌ Failed to create snapshot. Check logs for details.`,
        });
      }
    } catch (error) {
      console.error('[Test Snapshot] Error:', error);
      await interaction.editReply({
        content: `❌ Error creating snapshot: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  },
};
export default command;
