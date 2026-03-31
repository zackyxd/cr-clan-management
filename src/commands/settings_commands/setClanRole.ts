import {
  SlashCommandBuilder,
  InteractionContextType,
  ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { pool } from '../../db.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { checkPerms } from '../../utils/checkPermissions.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('set-clan-role')
    .setDescription(`(Manager) Set the clan role required to use certain commands.`)
    .addStringOption((option) =>
      option.setName('abbreviation').setDescription('Abbreviation of the clan').setRequired(true),
    )
    .addRoleOption((option) =>
      option.setName('role').setDescription('Which role to set for this clan?').setRequired(true),
    )
    .setContexts(InteractionContextType.Guild),

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

    const roleSelected = interaction.options.getRole('role');
    const abbreviation = interaction.options.getString('abbreviation');

    const clanRes = await pool.query(
      `SELECT clantag, clan_name, clan_role_id
       FROM clans
       WHERE guild_id = $1 AND abbreviation = LOWER($2)`,
      [guild.id, abbreviation],
    );
    const row = clanRes.rows[0];
    if (!row) {
      const embed = new EmbedBuilder()
        .setDescription(
          `❌ Clan with abbreviation \`${abbreviation}\` not found. Please assign it manually first in \`/clan-settings\``,
        )
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    await pool.query(`UPDATE clans SET clan_role_id = $1 WHERE guild_id = $2 AND clantag = $3`, [
      roleSelected?.id,
      guild.id,
      row.clantag,
    ]);

    const embed = new EmbedBuilder()
      .setDescription(`\`${row.clan_name}\` is now using the role <@&${roleSelected?.id}>`)
      .setColor(EmbedColor.SUCCESS);

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
