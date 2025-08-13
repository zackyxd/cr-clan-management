import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import pool from '../../db.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('set-staff-roles')
    .setDescription(`(Manager) Set the staff roles required to use certain commands.`)
    .addStringOption((option) =>
      option
        .setName('staff-type')
        .setDescription('Type of role to set for this type')
        .addChoices({ name: 'lower-role', value: 'lower' }, { name: 'higher-role', value: 'higher' })
        .setRequired(true)
    )
    .addRoleOption((option) => option.setName('role').setDescription('Which role to set?').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', ephemeral: true });
      return;
    }

    const typeSelected = interaction.options.getString('staff-type');
    const roleSelected = interaction.options.getRole('role');
    if (!typeSelected || !roleSelected) {
      await interaction.reply({ content: '❌ You must select an option for both.', ephemeral: true });
      return;
    }

    if (!['lower', 'higher'].includes(typeSelected)) {
      await interaction.reply({ content: '❌ Invalid type selected somehow.', ephemeral: true });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const columnName = `${typeSelected}_leader_role_id`;

    // Check roles before adding new one
    const originalRoleArray = await pool.query(
      `
      SELECT ${columnName} FROM server_settings WHERE guild_id = $1
      `,
      [guild.id]
    );

    // Insert new role into array
    const insertRole = await pool.query(
      `
      INSERT INTO server_settings (guild_id, ${columnName})
      VALUES ($1, ARRAY[$2]::text[])
      ON CONFLICT (guild_id) DO UPDATE
        SET ${columnName} = (
          SELECT ARRAY(
            SELECT DISTINCT e
            FROM unnest(array_append(server_settings.${columnName}, $2)) AS e
          )
        )
      RETURNING ${columnName}
      `,
      [guild.id, roleSelected.id]
    );

    const originalArray = originalRoleArray.rows[0]?.[columnName] || [];
    const originalSorted = [...originalArray].sort();

    const updatedArray = insertRole.rows[0][columnName];
    const updatedSorted = [...updatedArray].sort();

    const wasUpdated = originalSorted.join(',') !== updatedSorted.join(',');

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
    if (wasUpdated) {
      description += `You have successfully added ${roleSelected} to the *${
        typeSelected.charAt(0).toUpperCase() + typeSelected.substring(1)
      } Leader Roles* list.\n\n`;
    } else {
      description += `This role ${roleSelected} was already part of the *${
        typeSelected.charAt(0).toUpperCase() + typeSelected.substring(1)
      } Leader Roles* list.\n\n`;
    }

    description += `**Higher Leader Roles:** ${higherMentions}\n\n**Lower Leader Roles:** ${lowerMentions}`;

    const roleEmbed = new EmbedBuilder().setTitle('Staff Roles').setDescription(description).setColor(BOTCOLOR);

    await interaction.editReply({ embeds: [roleEmbed] });
  },
};

export default command;
