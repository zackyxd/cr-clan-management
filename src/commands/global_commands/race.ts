import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { normalizeTag } from '../../api/CR_API.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';
import { getRaceStats, initializeOrUpdateRace } from '../../features/race-tracking/service.js';
import { buildRaceEmbed } from '../../features/race-tracking/embedBuilders.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('race')
    .setDescription('Check the race of this clan')
    .addStringOption((option) => option.setName('clantag').setDescription('#ABC123').setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    const userInput = interaction.options.getString('clantag') as string;
    const normalizedTag = normalizeTag(userInput);

    const clanRes = await pool.query(
      `SELECT clantag FROM clans WHERE guild_id = $1 AND (clantag = $2 OR LOWER(abbreviation) = LOWER($3))`,
      [guild.id, normalizedTag, userInput],
    );

    const fixedClantag = clanRes.rows.length > 0 ? clanRes.rows[0].clantag : normalizedTag;

    const result = await initializeOrUpdateRace(fixedClantag);
    if (!result) {
      await interaction.editReply('❌ Failed to fetch race data. Please try again later.');
      return;
    }

    const { raceData, seasonId, warDay, warWeek, endTime } = result;
    const stats = getRaceStats(guild.id, raceData);

    if (!stats) {
      await interaction.editReply('❌ Failed to compute race stats. Please try again later.');
      return;
    }

    // Build and send embed
    const embed = buildRaceEmbed(stats, fixedClantag, seasonId, warWeek, warDay, endTime);
    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
