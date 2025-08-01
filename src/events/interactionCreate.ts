import { Collection, EmbedBuilder, Events, MessageFlags } from 'discord.js';
import type { Interaction } from 'discord.js';
import { Command } from '../types/Command.js';
// import buttonHandler from "../interactions/buttonHandler";
// import modalHandler from "../interactions/modalHandler";
// import { createErrorEmbed } from "../utils/embedUtility";
// import { isServerInitialized } from "../utils/initCheck";

export const event = {
  name: Events.InteractionCreate,
  async execute(interaction: Interaction) {
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName) as Command | undefined;
      if (!command) {
        return console.error(`❌ Command "${interaction.commandName}" not found.`);
      }

      const { cooldowns } = interaction.client;

      if (!cooldowns.has(command.data.name)) {
        cooldowns.set(command.data.name, new Collection());
      }

      const now = Date.now();
      const timestamps = cooldowns.get(command.data.name)!;
      const cooldownAmount = (command.cooldown ?? 0) * 1_000;

      const timestamp = timestamps.get(interaction.user.id);
      if (timestamp !== undefined) {
        const expirationTime = timestamp + cooldownAmount;

        if (now < expirationTime) {
          const expiredTimestamp = Math.round(expirationTime / 1_000);
          const cooldownEmbed = new EmbedBuilder()
            .setColor('Orange')
            .setDescription(`Command \`${command.data.name}\` on cooldown. Use again in <t:${expiredTimestamp}:R>.`);
          return interaction.reply({
            embeds: [cooldownEmbed],
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      timestamps.set(interaction.user.id, now);
      setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

      try {
        await command.execute(interaction);
      } catch (err: unknown) {
        console.error(`💥 Error in command "${interaction.commandName}":`, err);

        const reply = {
          content: 'There was an error while executing this command.',
          ephemeral: true,
        };

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
        } else if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
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
