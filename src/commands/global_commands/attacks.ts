import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { getCurrentRiverRace, isFetchError, normalizeTag } from '../../api/CR_API.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';

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

    const clantag = clanRes.rows.length > 0 ? clanRes.rows[0].clantag : normalizedTag;

    const attackData = await getCurrentRiverRace(clantag);

    if (isFetchError(attackData)) {
      await interaction.editReply({ content: `Error fetching attack data: ${attackData.reason}` });
      return;
    }

    console.log(attackData);
  },
};

export default command;
