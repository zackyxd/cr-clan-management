import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { pool } from '../../db.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('set-permanent-attacking-late')
    .setDescription('Set permanent attacking late for yourself')
    .addBooleanOption((option) => option.setName('set').setDescription('Set always attacking late?').setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }
    const setFlag = interaction.options.getBoolean('set') ?? false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await pool.query(
      `
      UPDATE users
      SET is_permanent_attacking_late = ${setFlag}
      WHERE guild_id = $1 AND discord_id = $2
      `,
      [guild.id, interaction.user.id],
    );

    await interaction.editReply(
      `You now have permanent attacking late set to \`${setFlag}\`.${setFlag === true ? '\nPlease still get your battles in everyday.' : '\nUse the `/attacking-late` command or the buttons on nudges to set attacking late as normal.'}`,
    );
  },
};

export default command;
