import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../types/Command.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('test-rollover')
    .setDescription('[Test] Test day rollover detection with fixtures')
    .addStringOption((option) =>
      option.setName('old-fixture').setDescription('Old race data fixture filename (e.g., day1)').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('new-fixture').setDescription('New race data fixture filename (e.g., day2)').setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const oldFixture = interaction.options.getString('old-fixture', true);
    const newFixture = interaction.options.getString('new-fixture', true);

    try {
      // Load fixtures
      const fixturesPath = path.join(__dirname, '../../api/fixtures/getCurrentRiverRace');
      const oldDataPath = path.join(fixturesPath, `${oldFixture}.json`);
      const newDataPath = path.join(fixturesPath, `${newFixture}.json`);

      if (!fs.existsSync(oldDataPath)) {
        await interaction.editReply(
          `❌ Old fixture not found: ${oldFixture}\n\nAvailable: ${fs.readdirSync(fixturesPath).join(', ')}`,
        );
        return;
      }

      if (!fs.existsSync(newDataPath)) {
        await interaction.editReply(
          `❌ New fixture not found: ${newFixture}\n\nAvailable: ${fs.readdirSync(fixturesPath).join(', ')}`,
        );
        return;
      }

      const oldRaceData = JSON.parse(fs.readFileSync(oldDataPath, 'utf-8'));
      const newRaceData = JSON.parse(fs.readFileSync(newDataPath, 'utf-8'));

      // Import the function (this is a workaround since isNewWarDay is not exported)
      // You'll need to export it from service.ts or inline the logic here
      const { testRolloverDetection } = await import('../../features/race-tracking/service.js');

      const result = testRolloverDetection(oldRaceData, newRaceData);

      // Calculate stats for display
      const oldAttacks = oldRaceData.clans.reduce(
        (sum: number, clan: any) => sum + clan.participants.reduce((s: number, p: any) => s + p.decksUsedToday, 0),
        0,
      );
      const newAttacks = newRaceData.clans.reduce(
        (sum: number, clan: any) => sum + clan.participants.reduce((s: number, p: any) => s + p.decksUsedToday, 0),
        0,
      );

      const message = [
        `**Rollover Test Results**`,
        ``,
        `**Old Data (${oldFixture}):**`,
        `- Period Type: ${oldRaceData.periodType}`,
        `- Period Index: ${oldRaceData.periodIndex}`,
        `- Section Index: ${oldRaceData.sectionIndex}`,
        `- Total Attacks: ${oldAttacks}`,
        ``,
        `**New Data (${newFixture}):**`,
        `- Period Type: ${newRaceData.periodType}`,
        `- Period Index: ${newRaceData.periodIndex}`,
        `- Section Index: ${newRaceData.sectionIndex}`,
        `- Total Attacks: ${newAttacks}`,
        ``,
        `**Result:** ${result ? '✅ New Day Detected' : '❌ Same Day'}`,
      ].join('\n');

      await interaction.editReply(message);
    } catch (error) {
      console.error('[Test Rollover] Error:', error);
      await interaction.editReply({
        content: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  },
};

export default command;
