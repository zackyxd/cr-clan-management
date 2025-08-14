import { Collection, EmbedBuilder, Events, MessageFlags } from 'discord.js';
import type { Interaction } from 'discord.js';
import { Command } from '../types/Command.js';
import pool from '../db.js';
import { buildFeatureEmbedAndComponents } from '../interactions/buttons/serverSettings.js';
import { CR_API, isFetchError } from '../api/CR_API.js';
import { formatPlayerData } from '../api/FORMAT_DATA.js';
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
    } else if (interaction.isModalSubmit()) {
      const [type, guildId, settingKey, isChannel] = interaction.customId.split(':');
      const messageId = interaction.message?.id;
      if (!messageId) return;
      const message = await interaction.channel?.messages.fetch(messageId);
      if (!message) return;
      if (type === 'modal_submit' && settingKey === 'opened_identifier') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const newValue = interaction.fields.getTextInputValue('input').toLowerCase();
        await pool.query(
          `
          UPDATE ticket_settings SET ${settingKey} = $1 WHERE guild_id = $2
          `,
          [newValue, guildId]
        );
        const { embed, components } = await buildFeatureEmbedAndComponents(
          guildId,
          'tickets',
          'Ticket features handles everything related to tickets and ensuring you can handle new members.'
        );
        await message.edit({ embeds: [embed], components });
        await interaction.editReply({ content: '✅ Updated successfully', embeds: [] });
      } else if (type === 'modal_submit' && settingKey === 'closed_identifier') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const newValue = interaction.fields.getTextInputValue('input').toLowerCase();
        await pool.query(
          `
          UPDATE ticket_settings SET ${settingKey} = $1 WHERE guild_id = $2
          `,
          [newValue, guildId]
        );
        const { embed, components } = await buildFeatureEmbedAndComponents(
          guildId,
          'tickets',
          'Ticket features handles everything related to tickets and ensuring you can handle new members.'
        );
        await message.edit({ embeds: [embed], components });
        await interaction.editReply({ content: '✅ Updated successfully', embeds: [] });
      } else if (type === 'modal_submit' && isChannel) {
        await interaction.deferReply();
        const inputTags = interaction.fields.getTextInputValue('input').toUpperCase().split(' ');
        // Remove empty strings
        const normalizedTags = inputTags.map((tag) => CR_API.normalizeTag(tag)).filter(Boolean);
        const { rows } = await pool.query(`SELECT playertags FROM tickets WHERE guild_id = $1 AND channel_id = $2`, [
          guildId,
          interaction.channelId,
        ]);

        const currentTags: string[] = rows[0]?.playertags ?? [];
        const validTags: string[] = [];
        const embeds: EmbedBuilder[] = [];
        const invalidEmbeds: EmbedBuilder[] = [];

        for (let tag of normalizedTags) {
          if (currentTags.includes(tag)) continue; // skip duplicates
          tag = CR_API.normalizeTag(tag);

          const playerData = await CR_API.getPlayer(tag);
          if (isFetchError(playerData)) {
            invalidEmbeds.push(playerData.embed);
            continue;
          }

          const embed = formatPlayerData(playerData);
          if (embed) embeds.push(embed);
          validTags.push(tag);
        }

        const uniqueValidTags = [...new Set(validTags)];

        if (embeds.length > 0) {
          await interaction.editReply({
            content: `**These are the entered playertags by <@${interaction.user.id}>**`,
            embeds: [...embeds, ...invalidEmbeds],
          });
        }

        await pool.query(
          `
          INSERT INTO tickets (guild_id, channel_id, playertags, created_by)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (guild_id, channel_id)
          DO UPDATE SET playertags = (
            SELECT ARRAY(
              SELECT DISTINCT unnest(t.playertags || EXCLUDED.playertags)
              ORDER BY 1
            )
            FROM tickets t
            WHERE t.guild_id = EXCLUDED.guild_id
              AND t.channel_id = EXCLUDED.channel_id
            )
          `,
          [guildId, interaction.channelId, uniqueValidTags, interaction.user.id]
        );
      }
    }
  },
};
