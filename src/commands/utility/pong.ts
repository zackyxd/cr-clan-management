import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import type { Command } from "../../types/Command.js";


const command: Command = {
  data: new SlashCommandBuilder()
    .setName('pong')
    .setDescription('Replies with Ping!'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply('Ping!')
  }
}

export default command;