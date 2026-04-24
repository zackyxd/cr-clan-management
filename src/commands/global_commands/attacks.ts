import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { normalizeTag } from '../../api/CR_API.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';
import { getRaceAttacks, initializeOrUpdateRace } from '../../features/race-tracking/index.js';
import { buildAttacksEmbed } from '../../features/race-tracking/embedBuilders.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('attacks')
    .setDescription('Check the attacks remaining in this clan')
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

    const { raceId, raceData, seasonId, warWeek, endTime } = result;
    const attacksData = await getRaceAttacks(guild.id, raceId, raceData, seasonId, warWeek);
    if (!attacksData) {
      await interaction.editReply('❌ Failed to fetch attacks data. Please try again later.');
      return;
    }

    // Build and send embed
    const embed = await buildAttacksEmbed(guild.id, attacksData, raceData, endTime, false);
    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
