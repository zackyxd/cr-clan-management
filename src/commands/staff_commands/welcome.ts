import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  TextChannel,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { pool } from '../../db.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { makeCustomId } from '../../utils/customId.js';
import logger from '../../logger.js';
import { getEmoji, hasEmoji } from '../../utils/emoji.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('(Coleader) Welcome a user to a clan — adds roles and sends a welcome message')
    .addStringOption((option) =>
      option.setName('clan').setDescription('Clan abbreviation or tag').setRequired(true).setAutocomplete(true),
    )
    .addUserOption((option) =>
      option.setName('user').setDescription('The @user to welcome (defaults to ticket owner)').setRequired(false),
    ),

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const focused = interaction.options.getFocused().toLowerCase();

    const result = await pool.query(
      `SELECT abbreviation, clan_name 
      FROM clans 
      WHERE guild_id = $1
        AND family_clan = TRUE
      ORDER BY clan_trophies desc, clan_name`,
      [guildId],
    );

    const choices = result.rows
      .filter(
        (row) => row.abbreviation.toLowerCase().includes(focused) || row.clan_name.toLowerCase().includes(focused),
      )
      .slice(0, 25)
      .map((row) => ({
        name: `${row.clan_name} (${row.abbreviation})`,
        value: row.abbreviation,
      }));

    await interaction.respond(choices);
  },

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allowed = await checkPerms(interaction, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: false,
    });
    if (!allowed) return;

    const clanInput = interaction.options.getString('clan', true).toLowerCase();
    let targetUser = interaction.options.getUser('user');

    // If no user provided, check if current channel is a ticket
    if (!targetUser) {
      const ticketRes = await pool.query(`SELECT created_by FROM tickets WHERE guild_id = $1 AND channel_id = $2`, [
        guild.id,
        interaction.channelId,
      ]);

      if (ticketRes.rows.length === 0) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setDescription('This channel is not a ticket. Please provide a `user` option.')
              .setColor(EmbedColor.FAIL),
          ],
        });
        return;
      }

      const createdBy = ticketRes.rows[0].created_by;
      if (!createdBy) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setDescription('Could not determine the ticket owner. Please provide a `user` option.')
              .setColor(EmbedColor.FAIL),
          ],
        });
        return;
      }

      try {
        targetUser = await interaction.client.users.fetch(createdBy);
      } catch {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setDescription(`Could not fetch ticket owner <@${createdBy}>. Please provide a \`user\` option.`)
              .setColor(EmbedColor.FAIL),
          ],
        });
        return;
      }
    }

    // Look up clan by abbreviation
    const clanRes = await pool.query(
      `SELECT c.clantag, c.clan_name, c.clan_role_id, c.race_nudge_channel_id, s.clan_roles_required_role_id
       FROM clans c
       LEFT JOIN server_settings s ON c.guild_id = s.guild_id
       WHERE c.guild_id = $1 AND LOWER(c.abbreviation) = $2`,
      [guild.id, clanInput],
    );

    if (clanRes.rows.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setDescription(`No clan found with abbreviation \`${clanInput}\`.`)
            .setColor(EmbedColor.FAIL),
        ],
      });
      return;
    }

    const clan = clanRes.rows[0];

    // Add roles to the user
    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder().setDescription(`<@${targetUser.id}> is not in this server.`).setColor(EmbedColor.FAIL),
        ],
      });
      return;
    }

    const rolesToAdd: string[] = [];
    if (clan.clan_roles_required_role_id && !member.roles.cache.has(clan.clan_roles_required_role_id)) {
      rolesToAdd.push(clan.clan_roles_required_role_id);
    }
    if (clan.clan_role_id && !member.roles.cache.has(clan.clan_role_id)) {
      rolesToAdd.push(clan.clan_role_id);
    }

    const rolesFailed: string[] = [];
    for (const roleId of rolesToAdd) {
      try {
        await member.roles.add(roleId);
      } catch (error) {
        rolesFailed.push(roleId);
        logger.warn(`[Welcome] Failed to add role ${roleId} to ${targetUser.id}:`, error);
      }
    }

    // Build status line for each role
    const roleLines: string[] = [];
    if (clan.clan_roles_required_role_id) {
      roleLines.push(`<@&${clan.clan_roles_required_role_id}>`);
    }
    if (clan.clan_role_id) {
      roleLines.push(`<@&${clan.clan_role_id}>`);
    }

    const channelMention = clan.race_nudge_channel_id ? `<#${clan.race_nudge_channel_id}>` : 'N/A';
    const channelLine = clan.race_nudge_channel_id
      ? `Sending the welcome message to: ${channelMention}`
      : `No nudge channel configured for ${clan.clan_name} — skipping welcome message`;
    const descriptionLine =
      roleLines.length === 0
        ? `**There are no roles configured to add to <@${targetUser.id}>.**\n${channelLine}`
        : `**The user <@${targetUser.id}> should now have ${roleLines.join(' and ')} roles.**\n${channelLine}`;
    const confirmEmbed = new EmbedBuilder()
      .setDescription(descriptionLine)
      .setColor(rolesFailed.length > 0 ? EmbedColor.WARNING : EmbedColor.SUCCESS);

    await interaction.editReply({ embeds: [confirmEmbed] });

    // Send welcome message to nudge channel after 5 seconds
    if (!clan.race_nudge_channel_id) return;

    const templateRes = await pool.query(`SELECT welcome_message FROM ticket_settings WHERE guild_id = $1`, [guild.id]);
    const welcomeTemplate = templateRes.rows[0]?.welcome_message;

    setTimeout(async () => {
      try {
        const channel = await interaction.client.channels.fetch(clan.race_nudge_channel_id);
        if (!channel || !(channel instanceof TextChannel)) return;

        const infoButton = new ButtonBuilder()
          .setCustomId(makeCustomId('b', 'ticket_welcome_info', guild.id, { cooldown: 3, ownerId: targetUser.id }))
          .setLabel('Click Me!')
          .setStyle(ButtonStyle.Primary);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(infoButton);

        await channel.send({
          content: `Welcome to **${clan.clan_name}**, <@${targetUser!.id}> ${hasEmoji('omgpepe') ? getEmoji('omgpepe') : '🎉'}\n${welcomeTemplate ? `Please click the button below to read any useful information.` : ''}`,
          components: welcomeTemplate ? [row] : [],
        });
      } catch (error) {
        logger.error(`[Welcome] Failed to send welcome message:`, error);
      }
    }, 5000);
  },
};

export default command;
