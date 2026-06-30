import { Collection, EmbedBuilder, Events, MessageFlags } from 'discord.js';
import type { Interaction } from 'discord.js';
import { Command } from '../types/Command.js';
import { InteractionDispatcher } from '../infrastructure/handlers/interaction-dispatcher.js';
import { StatsTracker } from '../services/statsTracker.js';
import logger, { commandLogger } from '../logger.js';

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
        return logger.error(`Command "${interaction.commandName}" not found.`);
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

      const options = interaction.options.data.map((o) => `${o.name}:${o.value ?? ''}`).join(' ');
      commandLogger.info(
        `/${interaction.commandName}${options ? ' ' + options : ''} | user:${interaction.user.id} guild:${interaction.guildId}`,
      );

      try {
        await command.execute(interaction);
        if (interaction.guildId) {
          StatsTracker.increment(interaction.guildId, 'total_commands_used').catch(() => {});
        }
      } catch (err: unknown) {
        logger.error(`Error in command "${interaction.commandName}":`, err);

        const reply = {
          content: 'There was an error while executing this command.',
          flags: MessageFlags.Ephemeral as const,
        };

        // Check if error is a timeout
        const isTimeout =
          err instanceof Error && (err.message.includes('timeout') || err.message.includes('Connect Timeout'));

        if (isTimeout) {
          reply.content = '⏱️ Request timed out - external service is slow. Please try again.';
        }

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply).catch(() => {
            logger.warn(`Failed to send error follow-up for "${interaction.commandName}" - interaction expired`);
          });
        } else if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code?: number }).code !== 10062
        ) {
          await interaction.reply(reply).catch(() => {
            logger.warn(`Failed to reply with error for "${interaction.commandName}" - interaction may have expired`);
          });
        }
      }
    } else if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName) as Command | undefined;
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (err) {
          logger.error(`Error in autocomplete for "${interaction.commandName}":`, err);
        }
      }
    } else if (interaction.isButton() || interaction.isModalSubmit() || interaction.isStringSelectMenu()) {
      // NEW: Route all interactions through the feature-based dispatcher
      try {
        await InteractionDispatcher.dispatch(interaction);

        // Track interaction statistics
        if (interaction.guildId) {
          if (interaction.isButton()) {
            StatsTracker.increment(interaction.guildId, 'total_buttons_clicked').catch(() => {});
          } else if (interaction.isModalSubmit()) {
            StatsTracker.increment(interaction.guildId, 'total_modals_submitted').catch(() => {});
          }
        }
      } catch (err: unknown) {
        logger.error('Error in interaction dispatcher:', err);

        // Try to respond if we haven't already
        const errorReply = {
          content: 'There was an error while processing this interaction.',
          flags: MessageFlags.Ephemeral as const,
        };

        try {
          if (interaction.isRepliable()) {
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp(errorReply);
            } else {
              await interaction.reply(errorReply);
            }
          }
        } catch (replyError) {
          logger.warn('Failed to send error reply:', replyError);
        }
      }
      // } else if (interaction.isStringSelectMenu()) {
      //   // handler name is the custom Id of the select menu
      //   const handler = (selectMenuHandlers as Record<string, unknown>)[interaction.customId.split(':')[0]];
      //   const { ownerId } = parseCustomId(interaction.customId);
      //   if (interaction.user.id != ownerId) {
      //     await interaction.reply({
      //       content: `Sorry, you cannot use these options. Please run your own \`/${
      //         interaction.customId.split(':')[0]
      //       }\` command.`,
      //       flags: MessageFlags.Ephemeral,
      //     });
      //     return;
      //   }
      //   if (typeof handler === 'function') {
      //     await (handler as (interaction: Interaction) => Promise<void>)(interaction);
      //   }
    }
  },
};
