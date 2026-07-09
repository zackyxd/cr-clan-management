import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';
import { postRacePingsToChannels } from '../../features/race-tracking/index.js';
import { buildAttackingLateInfo } from '../../features/race-tracking/attackingLateInfo.js';

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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

    // Check if a message was already sent today
    const userCheck = await pool.query(
      `SELECT attacking_late_ping_sent_today FROM users WHERE guild_id = $1 AND discord_id = $2`,
      [guild.id, interaction.user.id],
    );

    const alreadySentToday = userCheck.rows[0]?.attacking_late_ping_sent_today || false;

    // Update users table to mark as attacking late
    await pool.query(
      `UPDATE users 
       SET is_attacking_late = true${!alreadySentToday ? ', attacking_late_ping_sent_today = true' : ''}
       WHERE guild_id = $1 AND discord_id = $2`,
      [guild.id, interaction.user.id],
    );

    // Send pings to clan channels only if not already sent today
    if (!alreadySentToday) {
      await postRacePingsToChannels(guild.id, playertags, 'late', messages);
    }

    const lateInfo = await buildAttackingLateInfo(guild.id, interaction.user.id);
    await interaction.editReply({
      content: `✅ **You are now marked as attacking late**.\n\n${lateInfo}`,
    });
  },
};

export default command;
