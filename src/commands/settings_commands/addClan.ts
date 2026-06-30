import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { linkClan } from '../../services/clans.js';
import logger from '../../logger.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('add-clan')
    .setDescription('(Management) Link a clan to your server')
    .addStringOption((option) => option.setName('clantag').setDescription('#ABC123').setRequired(true))
    .addStringOption((option) =>
      option
        .setName('abbreviation')
        .setDescription('10 character max abbreviation for this clan')
        .setRequired(true)
        .setMaxLength(10),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    // TODO think about if i need a checkFeatureEnbabled() check here

    const allowed = await checkPerms(interaction, 'command', 'higher', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;
    // await interaction.deferReply();

    const clantag = interaction.options.getString('clantag') as string;
    const abbreviation = interaction.options.getString('abbreviation') as string;

    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const { embed } = await linkClan(client, guild.id, clantag, abbreviation);
      await interaction.editReply({ embeds: [embed] });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`Error from addClan.ts`, error);
      await interaction.editReply({ content: `There was an error with linking: ${error}` });
    } finally {
      client.release();
    }
  },
};

export default command;
