import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, EmbedBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { normalizeTag } from '../../api/CR_API.js';
import { pool } from '../../db.js';
import { checkClanActivity } from '../../features/clan-logs/index.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import type { ClanActivityData } from '../../features/clan-logs/types.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('check-clan-logs')
    .setDescription('(Staff) Manually trigger a clan activity check')
    .addStringOption((option) =>
      option.setName('clantag').setDescription('Clan tag or abbreviation').setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;

    const userInput = interaction.options.getString('clantag', true);
    const normalizedTag = normalizeTag(userInput);

    // Query clan data
    const clanRes = await pool.query<ClanActivityData>(
      `SELECT 
        c.guild_id,
        c.clantag, 
        c.clan_name,
        c.clan_role_id,
        c.clan_logs_enabled,
        c.clan_logs_channel_id,
        c.clan_logs_manage_roles,
        c.clan_logs_add_role,
        c.clan_logs_remove_role,
        c.last_activity_snapshot,
        c.last_activity_check_at,
        s.clan_roles_required_role_id
       FROM clans c
       LEFT JOIN server_settings s ON c.guild_id = s.guild_id
       WHERE c.guild_id = $1 
         AND (c.clantag = $2 OR LOWER(c.abbreviation) = LOWER($3))`,
      [guild.id, normalizedTag, userInput],
    );

    if (clanRes.rows.length === 0) {
      await interaction.editReply({
        content: `❌ Clan not found. Make sure it's added to your server with \`/add-clan\`.`,
      });
      return;
    }

    const clanData = clanRes.rows[0];

    // Check if clan logs are enabled
    if (!clanData.clan_logs_enabled) {
      const embed = new EmbedBuilder()
        .setDescription(
          `❌ Clan logs are **disabled** for **${clanData.clan_name}**.\n\nEnable them in \`/clan-settings\`.`,
        )
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (!clanData.clan_logs_channel_id) {
      const embed = new EmbedBuilder()
        .setDescription(
          `❌ No logs channel configured for **${clanData.clan_name}**.\n\nSet one in \`/clan-settings\`.`,
        )
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Trigger the check
    try {
      await checkClanActivity(interaction.client, clanData);

      const embed = new EmbedBuilder()
        .setDescription(
          `✅ Activity check completed for **${clanData.clan_name}**!\n\n` +
            `Changes (if any) have been logged to <#${clanData.clan_logs_channel_id}>.`,
        )
        .setColor(EmbedColor.SUCCESS);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error checking clan activity:', error);
      await interaction.editReply({
        content: '❌ Failed to check clan activity. Check bot permissions and API status.',
      });
    }
  },
};

export default command;
