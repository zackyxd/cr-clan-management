import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { isDev } from '../../utils/env.js';

const command: Command = {
  data: new SlashCommandBuilder().setName('delete-channel').setDescription('(dev only) Delete a channel'),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (isDev && interaction && interaction.channel) {
      await interaction.channel.delete();
    }
  },
};

export default command;
