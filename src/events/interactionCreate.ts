import { Events } from "discord.js";
import type { Interaction } from "discord.js";
// import buttonHandler from "../interactions/buttonHandler";
// import modalHandler from "../interactions/modalHandler";
// import { createErrorEmbed } from "../utils/embedUtility";
// import { isServerInitialized } from "../utils/initCheck";

export const event = {
  name: Events.InteractionCreate,
  async execute(interaction: Interaction) {
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) {
        return console.error(`❌ Command "${interaction.commandName}" not found.`);
      }

      try {
        await command.execute(interaction);
      }
      catch (err: unknown) {
        console.error(`💥 Error in command "${interaction.commandName}":`, err);

        const reply = {
          content: "There was an error while executing this command.",
          ephemeral: true,
        };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
        }
        else if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code?: number }).code !== 10062
        ) {
          await interaction.reply(reply);
        }
      }

      // Future handling:
      // } else if (interaction.isButton()) {
      //   await buttonHandler.handle(interaction);
      // } else if (interaction.isModalSubmit()) {
      //   await modalHandler.handle(interaction);
      // }
    }
  },
};
