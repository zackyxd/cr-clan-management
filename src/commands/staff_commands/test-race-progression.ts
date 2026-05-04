import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { CurrentRiverRace } from '../../api/CR_API.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the race service functions directly (we'll mock the API calls)
import { initializeOrUpdateRace, getDayForDisplay } from '../../features/race-tracking/service.js';

// Test progression sequence
const TEST_SEQUENCE = [
  {
    name: 'S131 W1 D1',
    raceFile: 's131-w1-d1.json',
    logFile: 's131-w1-ongoing.json',
    description: 'Season 131, Week 1, War Day 1',
  },
  {
    name: 'S131 W1 D2',
    raceFile: 's131-w1-d2.json',
    logFile: 's131-w1-ongoing.json',
    description: 'Season 131, Week 1, War Day 2 (Day Rollover)',
  },
  {
    name: 'S131 W4 D4',
    raceFile: 's131-w4-d4.json',
    logFile: 's131-w4-complete.json',
    description: 'Season 131, Week 4, Colosseum Day 4 (Week Jump)',
  },
  {
    name: 'S132 Training',
    raceFile: 's132-training.json',
    logFile: 's131-w4-complete.json',
    description: 'Season 132, Training Day (Season Rollover)',
  },
  {
    name: 'S132 W1 D1',
    raceFile: 's132-w1-d1.json',
    logFile: 's132-w1-ongoing.json',
    description: 'Season 132, Week 1, War Day 1 (Training→War)',
  },
];

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('test-race-progression')
    .setDescription('[Test] Simulate race progression through multiple days/weeks/seasons')
    .addStringOption((option) =>
      option.setName('clantag').setDescription('Clan tag to use for testing').setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('delay')
        .setDescription('Delay between steps in seconds (default: 3)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(60),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const clantagInput = interaction.options.getString('clantag', true);
    const clantag = clantagInput.startsWith('#') ? clantagInput : `#${clantagInput}`;
    const delay = (interaction.options.getInteger('delay') || 3) * 1000;
    const guildId = interaction.guildId!;

    try {
      // Verify clan is tracked in this guild
      const clanCheck = await pool.query(`SELECT clantag FROM clans WHERE guild_id = $1 AND clantag = $2`, [
        guildId,
        clantag,
      ]);

      if (clanCheck.rows.length === 0) {
        await interaction.editReply({
          content: `❌ Clan ${clantag} is not tracked in this server. Add it first with \`/add-clan\`.`,
        });
        return;
      }

      const progressEmbed = new EmbedBuilder()
        .setTitle('🧪 Race Progression Test Starting')
        .setDescription(
          `Testing race transitions with **${clantag}**\n\n` +
            `**Sequence:**\n${TEST_SEQUENCE.map((step, i) => `${i + 1}. ${step.description}`).join('\n')}\n\n` +
            `Delay between steps: **${delay / 1000}s**`,
        )
        .setColor(Colors.Blue)
        .setFooter({ text: 'This will trigger real snapshot creation and channel posts!' });

      await interaction.editReply({ embeds: [progressEmbed] });

      // Dynamic import to override API calls
      const CR_API = await import('../../api/CR_API.js');

      // Store original functions
      const originalGetCurrentRace = CR_API.getCurrentRiverRace;
      const originalGetLog = CR_API.getRiverRaceLog;

      let currentStep = 0;

      // Override API calls to return our fixtures
      CR_API.getCurrentRiverRace = async (tag: string) => {
        if (tag !== clantag) return originalGetCurrentRace(tag);

        const step = TEST_SEQUENCE[currentStep];
        const fixturePath = path.join(
          __dirname,
          '..',
          '..',
          'api',
          'fixtures',
          'getCurrentRiverRace',
          step.raceFile,
        );

        try {
          const content = await fs.readFile(fixturePath, 'utf-8');
          const data = JSON.parse(content) as CurrentRiverRace;
          data.clan.tag = clantag; // Replace test tag with real clan
          data.clans[0].tag = clantag;
          console.log(`[Test] Loaded fixture ${step.raceFile} for ${clantag}`);
          return data;
        } catch (error) {
          console.error(`Failed to load fixture ${step.raceFile}:`, error);
          throw error;
        }
      };

      CR_API.getRiverRaceLog = async (tag: string) => {
        if (tag !== clantag) return originalGetLog(tag);

        const step = TEST_SEQUENCE[currentStep];
        const fixturePath = path.join(__dirname, '..', '..', 'api', 'fixtures', 'getRiverRaceLog', step.logFile);

        try {
          const content = await fs.readFile(fixturePath, 'utf-8');
          const data = JSON.parse(content);
          console.log(`[Test] Loaded log fixture ${step.logFile} for ${clantag}`);
          return data;
        } catch (error) {
          console.error(`Failed to load log fixture ${step.logFile}:`, error);
          throw error;
        }
      };

      // Execute each step
      for (let i = 0; i < TEST_SEQUENCE.length; i++) {
        currentStep = i;
        const step = TEST_SEQUENCE[i];

        const stepEmbed = new EmbedBuilder()
          .setTitle(`Step ${i + 1}/${TEST_SEQUENCE.length}: ${step.name}`)
          .setDescription(step.description)
          .setColor(Colors.Yellow);

        await interaction.followUp({ embeds: [stepEmbed], ephemeral: true });

        // Call the actual race update logic with our mocked data
        const result = await initializeOrUpdateRace(clantag);

        if (result) {
          const resultEmbed = new EmbedBuilder()
            .setTitle(`✅ ${step.name} Complete`)
            .setDescription(
              `**Race ID:** ${result.raceId}\n` +
                `**Season:** ${result.seasonId || 'NULL'}\n` +
                `**Week:** ${result.warWeek}\n` +
                `**Day:** ${getDayForDisplay(result.warDay)}\n` +
                `**State:** ${result.periodType}`,
            )
            .setColor(Colors.Green);

          await interaction.followUp({ embeds: [resultEmbed], ephemeral: true });

          // Check for snapshots created
          const snapshotCheck = await pool.query(
            `SELECT COUNT(*) as count FROM race_day_snapshots WHERE race_id = $1`,
            [result.raceId],
          );
          const snapshotCount = snapshotCheck.rows[0].count;

          if (snapshotCount > 0) {
            await interaction.followUp({
              content: `📸 **${snapshotCount}** snapshot(s) exist for this race`,
              ephemeral: true,
            });
          }
        } else {
          await interaction.followUp({
            content: `❌ Failed to process step ${i + 1}`,
            ephemeral: true,
          });
        }

        // Wait before next step
        if (i < TEST_SEQUENCE.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Restore original functions
      CR_API.getCurrentRiverRace = originalGetCurrentRace;
      CR_API.getRiverRaceLog = originalGetLog;

      // Final summary
      const raceQuery = await pool.query(
        `SELECT race_id, season_id, current_week, current_day, race_state, created_at
         FROM river_races
         WHERE clantag = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [clantag],
      );

      const summaryEmbed = new EmbedBuilder()
        .setTitle('🎉 Test Complete!')
        .setDescription(
          `**Recent Races:**\n` +
            raceQuery.rows
              .map(
                (r) =>
                  `Race ${r.race_id}: S${r.season_id || '?'} W${r.current_week} D${getDayForDisplay(r.current_day)} (${r.race_state})`,
              )
              .join('\n'),
        )
        .setColor(Colors.Green)
        .setFooter({ text: 'Check your staff channel for posted summaries!' });

      await interaction.followUp({ embeds: [summaryEmbed], ephemeral: true });
    } catch (error) {
      console.error('[Test] Error during race progression test:', error);
      await interaction.followUp({
        content: `❌ Error during test: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ephemeral: true,
      });
    }
  },
};

export default command;
