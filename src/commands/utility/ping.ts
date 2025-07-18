import { ChatInputCommandInteraction, InteractionCallbackResponse, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../../types/Command.js';

const command: Command = {
  cooldown: 2,
  data: new SlashCommandBuilder().setName('ping').setDescription('Replies with Pong!'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sent: InteractionCallbackResponse = await interaction.reply({ content: 'Pinging...', withResponse: true });
    const message = sent.resource?.message;
    const createdTimestamp = message?.createdTimestamp;
    if (createdTimestamp !== undefined && createdTimestamp !== null) {
      const latency = createdTimestamp - interaction.createdTimestamp;
      await interaction.editReply(`Roundtrip latency: ${latency}ms`);
    } else {
      // Handle the case where createdTimestamp is undefined or null
      await interaction.editReply('Could not determine latency.');
    }
  },
};

export default command;
