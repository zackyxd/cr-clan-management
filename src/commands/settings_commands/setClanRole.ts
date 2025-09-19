import {
  SlashCommandBuilder,
  InteractionContextType,
  ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import pool from '../../db.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { DEFAULT_CLAN_SETTINGS } from '../../config/clanSettingsConfig.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('set-clan-role')
    .setDescription(`(Manager) Set the clan role required to use certain commands.`)
    .addStringOption((option) =>
      option.setName('abbreviation').setDescription('Abbreviation of the clan').setRequired(true)
    )
    .addRoleOption((option) =>
      option.setName('role').setDescription('Which role to set for this clan?').setRequired(true)
    )
    .setContexts(InteractionContextType.Guild),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const roleSelected = interaction.options.getRole('role');
    const abbreviation = interaction.options.getString('abbreviation')?.toLowerCase();

    await interaction.deferReply();
    const clanRes = await pool.query(
      `
        SELECT c.clantag, c.clan_name, cs.settings
        FROM clans c
        LEFT JOIN clan_settings cs
          ON c.guild_id = cs.guild_id AND c.clantag = cs.clantag
        WHERE c.guild_id = $1 AND c.abbreviation = $2
        `,
      [guild.id, abbreviation]
    );
    const row = clanRes.rows[0];
    if (!row) {
      const embed = new EmbedBuilder()
        .setDescription(
          `❌ Clan with abbreviation \`${abbreviation}\` not found. Please assign it manually first in \`/clan-settings\``
        )
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const currentSettings = { ...DEFAULT_CLAN_SETTINGS, ...(clanRes.rows[0]?.settings ?? {}) };
    currentSettings.clan_role_id = roleSelected?.id;
    await pool.query(`UPDATE clan_settings SET settings = $1 WHERE guild_id = $2 AND clantag = $3`, [
      currentSettings,
      guild.id,
      clanRes.rows[0]?.clantag,
    ]);

    const embed = new EmbedBuilder()
      .setDescription(`\`${row.clan_name}\` is now using the role <@&${roleSelected?.id}>`)
      .setColor(EmbedColor.SUCCESS);

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
