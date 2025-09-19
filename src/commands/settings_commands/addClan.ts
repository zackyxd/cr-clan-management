import { ChatInputCommandInteraction, GuildMember, MessageFlags, SlashCommandBuilder } from 'discord.js';
import pool from '../../db.js';
import { Command } from '../../types/Command.js';
import { buildCheckHasRoleQuery, checkPermissions } from '../../utils/checkPermissions.js';
import { linkClan } from '../../services/clans.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('add-clan')
    .setDescription('(Management) Link a clan to your server')
    .addStringOption((option) => option.setName('clantag').setDescription('#ABC123').setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    const userId = interaction.user.id;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    // TODO think about if i need a checkFeatureEnbabled() check here

    const member = interaction.member instanceof GuildMember ? interaction.member : await guild.members.fetch(userId);
    const getRoles = await pool.query(buildCheckHasRoleQuery(guild.id));
    const { higher_leader_role_id } = getRoles.rows[0] ?? [];
    const requiredRoleIds = [higher_leader_role_id].filter(Boolean) as string[];
    const hasPerms = await checkPermissions('command', member, requiredRoleIds);
    if (hasPerms && hasPerms.data) {
      await interaction.reply({ embeds: [hasPerms], flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply();

    const clantag = interaction.options.getString('clantag') as string;

    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const { embed, components } = await linkClan(client, guild.id, clantag);
      await interaction.editReply({ embeds: [embed] });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.log(`error from addClan.ts`, error);
      await interaction.editReply({ content: `There was an error with linking: ${error}` });
    } finally {
      client.release();
    }
  },
};

export default command;
