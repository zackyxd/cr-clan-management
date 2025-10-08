import { ChatInputCommandInteraction, GuildMember, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { pool } from '../../db.js';
import { buildCheckHasRoleQuery, checkPermissions } from '../../utils/checkPermissions.js';
import { unlinkUser } from '../../services/users.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription(`(Coleader) Unlink a Discord User from a Clash Royale account`)
    .addStringOption((option) =>
      option.setName('playertag').setDescription('#ABC123').setMinLength(4).setMaxLength(13).setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    const userId = interaction.user.id;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const member = interaction.member instanceof GuildMember ? interaction.member : await guild.members.fetch(userId);

    const getRoles = await pool.query(buildCheckHasRoleQuery(guild.id));
    const { lower_leader_role_id, higher_leader_role_id } = getRoles.rows[0] ?? [];
    const requiredRoleIds = [lower_leader_role_id, higher_leader_role_id].filter(Boolean) as string[];
    const hasPerms = await checkPermissions('command', member, requiredRoleIds);
    if (hasPerms && hasPerms.data) {
      await interaction.reply({ embeds: [hasPerms], flags: MessageFlags.Ephemeral });
      return;
    }

    const playertag = interaction.options.getString('playertag') as string;

    await interaction.deferReply();
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const embed = await unlinkUser(client, guild.id, playertag);
      await interaction.editReply({ embeds: [embed] });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.log(error);
      await interaction.editReply({ content: `There was an error with unlinking: ${error}` });
    } finally {
      client.release();
    }
  },
};

export default command;
