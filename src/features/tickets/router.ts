import {
  ActionRowBuilder,
  ButtonInteraction,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { ParsedCustomId } from '../../types/ParsedCustomId.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { CR_API } from '../../api/CR_API.js';
import { formatPlayerData } from '../../api/FORMAT_DATA.js';
import logger from '../../logger.js';
import { ticketService } from './service.js';
import { makeCustomId } from '../../utils/customId.js';
import { pool } from '../../db.js';
import { buildFindLinkedDiscordId, buildUpsertRelinkPlayertag } from '../../sql_queries/users.js';
import { EmbedColor } from '../../types/EmbedUtil.js';

export class TicketInteractionRouter {
  /**
   * Handle ticket button interactions
   */
  static async handleButton(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, guildId } = parsed;

    switch (action) {
      case 'ticketPlayertagsOpenModal':
        // Anyone can enter playertags - no permission check needed
        await this.showPlayertagsModal(interaction, guildId);
        break;
      case 'ticketsRelinkUser': {
        // Staff only - check permissions
        const allowed = await checkPerms(interaction, guildId, 'button', 'higher', {
          hideNoPerms: true,
          skipDefer: true,
        });
        if (!allowed) return;
        await this.relinkUser(interaction, parsed);
        break;
      }
      case 'ticket_openclose': {
        // Staff only - check permissions
        const allowed = await checkPerms(interaction, guildId, 'button', 'higher', {
          hideNoPerms: true,
          skipDefer: false,
        });
        if (!allowed) return;
        const channelId = parsed.extra?.[0];
        await this.changeTicketStatus(interaction, guildId, channelId);
        break;
      }

      default:
        await interaction.reply({
          content: 'Unknown ticket action.',
          ephemeral: true,
        });
    }
  }

  /**
   * Handle ticket modal interactions
   */
  static async handleModal(interaction: ModalSubmitInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action, guildId } = parsed;
    console.log('handle modal for tickets');
    switch (action) {
      case 'ticketPlayertagsOpenModal': {
        // Anyone can submit playertags - no permission check needed
        // Check if ticket is closed first to determine defer mode
        const res = await pool.query(`SELECT is_closed FROM tickets WHERE guild_id = $1 AND channel_id = $2`, [
          guildId,
          interaction.channelId,
        ]);
        const isClosed = res.rows[0]?.is_closed === true;

        // Defer with ephemeral if closed, non-ephemeral if open
        await interaction.deferReply({ ephemeral: isClosed });
        await this.handleModalSubmit(interaction, guildId);
        break;
      }

      default:
        await interaction.deferReply();
        await interaction.editReply({
          content: 'Unknown ticket modal action.',
        });
    }
  }

  /**
   * Handle select menu interactions
   */
  static async handleSelectMenu(_interaction: StringSelectMenuInteraction, parsed: ParsedCustomId): Promise<void> {
    const { action } = parsed;
    logger.info('Ticket select menu action:', action);
    // No select menus for tickets yet
  }

  /**
   * Show modal for entering playertags
   */
  private static async showPlayertagsModal(interaction: ButtonInteraction, guildId: string): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId(makeCustomId('m', 'ticketPlayertagsOpenModal', guildId))
      .setTitle('Enter Clash Royale Playertags')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('input')
            .setLabel('Separate multiple tags by spaces')
            .setPlaceholder('#ABC123 #DEF456 #GHI789')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true),
        ),
      );

    await interaction.showModal(modal);
  }

  private static async relinkUser(interaction: ButtonInteraction, parsed: ParsedCustomId): Promise<void> {
    const { guildId, extra } = parsed;
    const [originalDiscordId, playertag] = extra || [];
    if (!originalDiscordId || !playertag) {
      await interaction.reply({
        content: 'Invalid relink data.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferUpdate();

    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      // Old account
      const currentDiscordIdQuery = await client.query(buildFindLinkedDiscordId(guildId, playertag));
      const currentDiscordId = currentDiscordIdQuery.rows[0].discord_id;

      // New account - relink to new discord id
      const relinkQuery = buildUpsertRelinkPlayertag(guildId, originalDiscordId, playertag);
      const relinkRes = await client.query(relinkQuery);
      const newDiscordId = relinkRes.rows[0].new_discord_id;

      if (currentDiscordId !== newDiscordId) {
        const playerData = await CR_API.getPlayer(playertag);
        if ('error' in playerData) {
          await interaction.editReply({
            content: `⚠️ Could not fetch data for ${playertag}: ${playerData.error}`,
          });
          await client.query('ROLLBACK');
          return;
        }

        const playerEmbed = formatPlayerData(playerData);
        if (!playerEmbed) {
          await interaction.editReply({ content: 'There was an error with showing player data' });
          await client.query('ROLLBACK');
          return;
        }

        const getUser = await interaction.guild?.members.fetch(newDiscordId);
        playerEmbed?.setFooter({ text: `Relinked | ${playertag}`, iconURL: getUser?.displayAvatarURL() });
        await interaction.editReply({ embeds: [playerEmbed], components: [] });
        await interaction.followUp({
          content: `The playertag \`${playertag}\` has been relinked from <@${currentDiscordId}> → <@${newDiscordId}>`,
          flags: MessageFlags.Ephemeral,
        });

        // Handle renaming if enabled
        try {
          if (!interaction.guild) {
            await client.query('COMMIT');
            return;
          }

          const renameEnabled = await client.query(
            `
            SELECT rename_players
            FROM link_settings
            WHERE guild_id = $1
            `,
            [interaction.guild.id],
          );

          if (renameEnabled.rows[0]?.['rename_players']) {
            const member: GuildMember | null = await interaction.guild.members.fetch(newDiscordId).catch(() => null);

            if (!member) {
              await interaction.followUp({
                embeds: [
                  new EmbedBuilder().setDescription('**This user is not in this server.**').setColor(EmbedColor.FAIL),
                ],
                flags: MessageFlags.Ephemeral,
              });
            } else {
              await member.setNickname(playerData.name);
            }
          }
        } catch (error) {
          await interaction.followUp({
            content: `Could not rename this player.`,
            flags: MessageFlags.Ephemeral,
          });
          logger.info(error);
        }

        await client.query('COMMIT');
        await ticketService.sendLog(
          interaction.client,
          guildId,
          'Playertag Relinked',
          `Playertag \`${playertag}\` relinked from <@${currentDiscordId}> → <@${newDiscordId}>\n-# By <@${interaction.user.id}>`,
        );
      } else {
        await client.query('ROLLBACK');
        await interaction.editReply({
          content: `There was an error with relinking...try again or contact @Zacky`,
        });
      }
    } catch (error) {
      logger.error(`Error in relinkUser: ${error}`);
      await client.query('ROLLBACK');
      await interaction.followUp({
        content: `Error with relinking: ${error}`,
        flags: MessageFlags.Ephemeral,
      });
    } finally {
      client.release();
    }
  }

  /**
   * Handle ticket_channel modal submission (adding playertags)
   */
  private static async handleModalSubmit(interaction: ModalSubmitInteraction, guildId: string): Promise<void> {
    const rawInput = interaction.fields.getTextInputValue('input');

    const res = await pool.query(
      `
      SELECT is_closed FROM tickets WHERE guild_id = $1 AND channel_id = $2
    `,
      [guildId, interaction.channelId],
    );
    const ticketData = res.rows[0];
    if (ticketData && ticketData.is_closed === true) {
      await interaction.editReply({
        content: 'This ticket is currently closed from accepting new links. Please ask for it to be reopened.',
      });
      return;
    }
    // Split by any whitespace or comma, then normalize each tag
    const inputTags = rawInput.split(/[\s,]+/).filter((tag) => tag.length > 0);

    // Remove empty strings, normalize, and deduplicate
    const normalizedTags = [
      ...new Set(inputTags.map((tag) => CR_API.normalizeTag(tag)).filter((tag) => tag && tag.length > 1)),
    ];

    if (normalizedTags.length === 0) {
      await interaction.editReply({ content: 'No valid playertags provided.' });
      return;
    }

    if (!interaction.channelId) {
      await interaction.editReply({ content: 'Could not determine channel ID.' });
      return;
    }

    // Add playertags via service
    const result = await ticketService.addPlayertags({
      guildId,
      channelId: interaction.channelId,
      playertags: normalizedTags,
      userId: interaction.user.id,
    });

    if (!result.success) {
      await interaction.editReply({
        content: result.error || 'Failed to add playertags.',
      });
      return;
    }

    // Send response with embeds
    if (result.embeds && result.embeds.length > 0) {
      const allEmbeds = [...result.embeds, ...(result.invalidEmbeds || [])];

      // Filter out embeds that exceed Discord's 6000 character limit
      const getEmbedSize = (embed: EmbedBuilder) => {
        const data = embed.data;
        let size = 0;
        if (data.title) size += data.title.length;
        if (data.description) size += data.description.length;
        if (data.footer?.text) size += data.footer.text.length;
        if (data.author?.name) size += data.author.name.length;
        if (data.fields) {
          data.fields.forEach((field) => {
            size += field.name.length + field.value.length;
          });
        }
        return size;
      };

      // Create batches respecting both count (max 10) and size (max 6000 total) limits
      const batches: EmbedBuilder[][] = [];
      let currentBatch: EmbedBuilder[] = [];
      let currentBatchSize = 0;

      for (const embed of allEmbeds) {
        const embedSize = getEmbedSize(embed);

        // Skip embeds that are individually too large
        if (embedSize > 6000) {
          logger.warn(`Individual embed exceeds 6000 characters (${embedSize}), skipping`);
          continue;
        }

        // Check if adding this embed would exceed limits
        if (currentBatch.length >= 10 || (currentBatch.length > 0 && currentBatchSize + embedSize > 6000)) {
          // Start a new batch
          if (currentBatch.length > 0) {
            batches.push(currentBatch);
          }
          currentBatch = [embed];
          currentBatchSize = embedSize;
        } else {
          // Add to current batch
          currentBatch.push(embed);
          currentBatchSize += embedSize;
        }
      }

      // Add the last batch if it has embeds
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }

      if (batches.length === 0) {
        await interaction.editReply({
          content: `**Playertags added by <@${interaction.user.id}>** but embeds are too large to display. Check the database.`,
        });
      } else {
        // Send first batch as edit reply
        await interaction.editReply({
          content: `**These are the entered playertags by <@${interaction.user.id}>**`,
          embeds: batches[0],
        });

        // Send remaining batches as follow-ups
        for (let i = 1; i < batches.length; i++) {
          await interaction.followUp({
            embeds: batches[i],
          });
        }
      }

      await ticketService.sendLog(
        interaction.client,
        guildId,
        '📬 New Ticket',
        `<@${interaction.user.id}> created a ticket with the following playertags:\n${normalizedTags.join('\n')}`,
      );
    } else if (result.invalidEmbeds && result.invalidEmbeds.length > 0) {
      // Helper function to get embed size (same as above)
      const getEmbedSize = (embed: EmbedBuilder) => {
        const data = embed.data;
        let size = 0;
        if (data.title) size += data.title.length;
        if (data.description) size += data.description.length;
        if (data.footer?.text) size += data.footer.text.length;
        if (data.author?.name) size += data.author.name.length;
        if (data.fields) {
          data.fields.forEach((field) => {
            size += field.name.length + field.value.length;
          });
        }
        return size;
      };

      // Create batches respecting both count and size limits
      const batches: EmbedBuilder[][] = [];
      let currentBatch: EmbedBuilder[] = [];
      let currentBatchSize = 0;

      for (const embed of result.invalidEmbeds) {
        const embedSize = getEmbedSize(embed);

        if (embedSize > 6000) {
          logger.warn(`Invalid embed exceeds 6000 characters (${embedSize}), skipping`);
          continue;
        }

        if (currentBatch.length >= 10 || (currentBatch.length > 0 && currentBatchSize + embedSize > 6000)) {
          if (currentBatch.length > 0) {
            batches.push(currentBatch);
          }
          currentBatch = [embed];
          currentBatchSize = embedSize;
        } else {
          currentBatch.push(embed);
          currentBatchSize += embedSize;
        }
      }

      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }

      if (batches.length > 0) {
        await interaction.editReply({
          content: `Hey <@${interaction.user.id}>, the following playertags are invalid:`,
          embeds: batches[0],
        });

        for (let i = 1; i < batches.length; i++) {
          await interaction.followUp({
            content: '-# continue from above',
            embeds: batches[i],
          });
        }
      }
    } else {
      await interaction.editReply({
        content: 'All playertags were already added to this ticket.',
      });
    }
  }

  static async changeTicketStatus(interaction: ButtonInteraction, guildId: string, channelId: string): Promise<void> {
    // Get current ticket status
    const ticketData = await ticketService.getTicketData(guildId, channelId);

    if (!ticketData) {
      await interaction.editReply({
        content: 'Ticket not found.',
      });
      return;
    }

    // Toggle based on current status
    const result = ticketData.isClosed
      ? await ticketService.reopenTicket(guildId, channelId)
      : await ticketService.closeTicket({
          guildId,
          channelId,
          client: interaction.client,
        });

    if (!result.success) {
      await interaction.editReply({
        content: result.error || 'Failed to change ticket status.',
      });
      return;
    }

    // Handle response based on which action was taken
    if (ticketData.isClosed) {
      // Was closed, now reopened
      await interaction.editReply({
        content: '✅ Ticket has been reopened to accept new links.',
        embeds: [],
        components: [],
      });
    } else {
      // Was open, now closed - closeTicket returns embeds
      const { embeds } = result;
      if (embeds && embeds.length > 0) {
        await interaction.editReply({
          content: '✅ Ticket closed and players auto-linked.',
          components: [],
          embeds: [],
        });
      } else {
        await interaction.editReply({
          content: '✅ Ticket has been closed.',
          embeds: [],
          components: [],
        });
      }
    }
  }
}
