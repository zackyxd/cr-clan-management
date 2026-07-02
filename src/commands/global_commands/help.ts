import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';

const command: Command = {
  data: new SlashCommandBuilder().setName('guide').setDescription('Link to Document about RoyaleManager bot.'),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.reply({
      content: '[Bot Guide](<https://hackmd.io/@Zacky7/Hkq0Nb7XGx>)',
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
