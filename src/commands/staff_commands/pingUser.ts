import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { pool } from '../../db.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { checkPerms } from '../../utils/checkPermissions.js';

const PING_CHOICES = [
  { name: 'Regular - Ping for nudges (skip leaders/co-leaders)', value: 'regular' },
  { name: 'All - Always ping for nudges', value: 'all' },
  { name: 'None - Never ping for nudges', value: 'none' },
] as const;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ping-user')
    .setDescription("(Coleader) Set a user's nudge ping preference")
    .addUserOption((option) => option.setName('user').setDescription('The @user to update').setRequired(true))
    .addStringOption((option) =>
      option
        .setName('preference')
        .setDescription('Ping preference')
        .setRequired(true)
        .addChoices(...PING_CHOICES),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allowed = await checkPerms(interaction, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;

    const user = interaction.options.getUser('user', true);
    const preference = interaction.options.getString('preference', true);

    await pool.query(
      `INSERT INTO users (guild_id, discord_id, ping_user)
       VALUES ($1, $2, $3)
       ON CONFLICT (guild_id, discord_id)
       DO UPDATE SET ping_user = $3`,
      [guild.id, user.id, preference],
    );

    const label = PING_CHOICES.find((c) => c.value === preference)!.name;
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setDescription(`Updated <@${user.id}> ping preference to **${label}**`)
          .setColor(EmbedColor.SUCCESS),
      ],
    });
  },
};

export default command;
