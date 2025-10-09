import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { pool } from '../../db.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { unlinkUser } from '../../services/users.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription(`(Coleader) Unlink a Discord User from a Clash Royale account`)
    .addStringOption((option) =>
      option.setName('playertag').setDescription('#ABC123').setMinLength(4).setMaxLength(13).setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    // const userId = interaction.user.id;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;

    const playertag = interaction.options.getString('playertag') as string;

    await interaction.deferReply();
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const embed = await unlinkUser(client, guild.id, playertag);
      await interaction.editReply({ embeds: [embed] });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.log(error);
      await interaction.editReply({ content: `There was an error with unlinking: ${error}` });
    } finally {
      client.release();
    }
  },
};

export default command;
