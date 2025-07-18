import { SlashCommandBuilder } from "discord.js";
import type { Command } from "../../types/Command.js";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with Pong!"),

  async execute(interaction) {
    await interaction.reply("Pong!");
  },
};

export default command;
