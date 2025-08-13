import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ChatInputCommandInteraction,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import pool from '../../db.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('delete-staff-roles')
    .setDescription(`(Manager) Delete a staff role from being able to use certain commands.`)
    .addRoleOption((option) => option.setName('role').setDescription('Which role to delete?').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', ephemeral: true });
      return;
    }

    const roleSelected = interaction.options.getRole('role');
    if (!roleSelected) {
      await interaction.reply({ content: '❌ You must select a role.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await pool.query(
      `
      UPDATE server_settings
      SET lower_leader_role_id = array_remove(lower_leader_role_id, $1),
          higher_leader_role_id = array_remove(higher_leader_role_id, $1)
      WHERE guild_id = $2
      RETURNING lower_leader_role_id, higher_leader_role_id
      `,
      [roleSelected.id, guild.id]
    );

    // Fetch guild roles and validate still exist.
    const staffRoles = await pool.query(
      `
      SELECT lower_leader_role_id, higher_leader_role_id
      FROM server_settings
      WHERE guild_id = $1
      `,
      [guild.id]
    );

    const lowerRoles = staffRoles.rows[0]?.lower_leader_role_id || [];
    const higherRoles = staffRoles.rows[0]?.higher_leader_role_id || [];

    const guildRoles = guild.roles.cache;
    const validLowerRoles = lowerRoles.filter((id: string) => guildRoles.has(id));
    const validHigherRoles = higherRoles.filter((id: string) => guildRoles.has(id));

    await pool.query(
      `
      UPDATE server_settings
      SET lower_leader_role_id = $1,
          higher_leader_role_id = $2
      WHERE guild_id = $3
      `,
      [validLowerRoles, validHigherRoles, guild.id]
    );

    const lowerMentions = validLowerRoles.map((id: string) => `<@&${id}>`).join(', ') || 'None';
    const higherMentions = validHigherRoles.map((id: string) => `<@&${id}>`).join(', ') || 'None';

    let description = ``;
    description += `You have successfully deleted ${roleSelected} from the roles list\n\n`;

    description += `**Higher Leader Roles:** ${higherMentions}\n\n**Lower Leader Roles:** ${lowerMentions}`;

    const roleEmbed = new EmbedBuilder().setTitle('Staff Roles').setDescription(description).setColor(BOTCOLOR);

    await interaction.editReply({ embeds: [roleEmbed] });
  },
};

export default command;
