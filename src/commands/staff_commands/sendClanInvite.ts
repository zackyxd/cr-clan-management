import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, EmbedBuilder } from 'discord.js';
import { normalizeTag } from '../../api/CR_API.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { checkFeature } from '../../utils/checkFeatureEnabled.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { Command } from '../../types/Command.js';
import { pool } from '../../db.js';
import { clanInviteService } from '../../features/clan-invites/service.js';
import { createInviteEmbed } from '../../features/clan-invites/utils.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('send-invite')
    .setDescription('(Coleader+) Generate the active clan link for a clan.')
    .addStringOption((option) =>
      option
        .setName('tag-abbreviation')
        .setDescription('The clan tag or abbreviation for the clan you want to generate an invite for')
        .setRequired(true),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const featureCheck = await checkFeature(interaction, guild.id, 'clan_invites');
    if (!featureCheck) {
      return;
    }

    const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;

    const rawInput = interaction.options.getString('tag-abbreviation', true);
    const normalizedTag = normalizeTag(rawInput); // e.g., "v2gqu" or "#v2gqu" -> "#V2GQU"

    // Query with normalized tag OR case-insensitive abbreviation match
    const clanData = await pool.query(
      `SELECT clan_name, clantag, invites_enabled 
       FROM clans 
       WHERE guild_id = $1 AND (clantag = $2 OR abbreviation = LOWER($3))`,
      [guild.id, normalizedTag, rawInput],
    );

    if (clanData.rowCount === 0) {
      const embed = new EmbedBuilder()
        .setDescription(`❌ No clan found with tag or abbreviation **${rawInput}**.`)
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const clantag = clanData.rows[0].clantag; // Use actual tag from DB
    const clanName = clanData.rows[0].clan_name;
    const invitesEnabled = clanData.rows[0].invites_enabled;

    if (!invitesEnabled) {
      const embed = new EmbedBuilder()
        .setDescription(`❌ Invites are currently disabled for **${clanName}**.`)
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const invite = await clanInviteService.getActiveInviteWithClan(guild.id, clantag);

    if (!invite) {
      const embed = new EmbedBuilder()
        .setDescription(
          `❌ There is currently no active clan invite link for **${clanName}**.\nPlease generate one using \`/update-clan-invite\``,
        )
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Send invite to the current channel and track it
    const message = await clanInviteService.sendInviteToChannel(
      interaction.client,
      guild.id,
      interaction.channelId,
      clantag,
      '/send-invite',
      interaction.user.id,
    );

    if (message) {
      const confirmEmbed = new EmbedBuilder()
        .setDescription(`✅ Sent invite link for **${clanName}** below.`)
        .setColor(EmbedColor.SUCCESS);
      await interaction.editReply({ embeds: [confirmEmbed] });
    } else {
      const errorEmbed = new EmbedBuilder().setDescription(`❌ Failed to send invite link.`).setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  },
};

export default command;
