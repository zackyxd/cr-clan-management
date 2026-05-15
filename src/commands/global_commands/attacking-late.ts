import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';
import { postRacePingsToChannels } from '../../features/race-tracking/index.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('attacking-late')
    .setDescription('Notify clans that you will be attacking late')
    .addStringOption((option) =>
      option.setName('message').setDescription('Optional message explaining when you will attack').setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    // Get user's linked player tags
    const userLinkedTags = await pool.query(
      `SELECT playertag FROM user_playertags WHERE guild_id = $1 AND discord_id = $2`,
      [guild.id, interaction.user.id],
    );

    if (userLinkedTags.rows.length === 0) {
      await interaction.editReply('❌ You do not have any linked playertags.');
      return;
    }

    const playertags = userLinkedTags.rows.map((row) => row.playertag);
    const message = interaction.options.getString('message');

    // Build message map if user provided a message
    const messages = message ? new Map(playertags.map((tag) => [tag, message])) : undefined;

    // Update users table to mark as attacking late
    await pool.query(
      `UPDATE users 
       SET is_attacking_late = true
       WHERE guild_id = $1 AND discord_id = $2`,
      [guild.id, interaction.user.id],
    );

    // Send pings to clan channels
    await postRacePingsToChannels(guild.id, playertags, 'late', messages);

    await interaction.editReply({
      content:
        '✅ **You are now marked as attacking late**.\n\nYou will be excluded from the first half of attack reminders.',
    });
  },
};

export default command;
