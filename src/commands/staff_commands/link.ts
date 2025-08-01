import { ChatInputCommandInteraction, EmbedBuilder, GuildMember, SlashCommandBuilder, User } from 'discord.js';
import { Command } from '../../types/Command.js';
import { linkUser } from '../../services/users.js';
import pool from '../../db.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { buildCheckHasRoleQuery, checkPermissions } from '../../utils/check_has_role.js';
import { checkFeatureEnabled } from '../../utils/checkFeatureEnabled.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('(Coleader) Link a Discord User to a Clash Royale account')
    .addUserOption((option) =>
      option.setName('user').setDescription('The @user you would like to link').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('playertag').setDescription('#ABC123').setMinLength(4).setMaxLength(13).setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    const userId = interaction.user.id;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', ephemeral: true });
      return;
    }

    const check = await checkFeatureEnabled(guild.id, 'links');
    if (!check.enabled) {
      if (check.embed) {
        await interaction.reply({ embeds: [check.embed], ephemeral: true });
      } else {
        await interaction.reply({
          content: 'Error showing embed for feature not enabled. Contact @Zacky',
          ephemeral: true,
        });
      }
      return;
    }

    const member = interaction.member instanceof GuildMember ? interaction.member : await guild.members.fetch(userId);

    const getRoles = await pool.query(buildCheckHasRoleQuery(guild.id));
    const { lower_leader_role_id, higher_leader_role_id } = getRoles.rows[0] ?? [];
    const requiredRoleIds = [lower_leader_role_id, higher_leader_role_id].filter(Boolean) as string[];
    const hasPerms = await checkPermissions('command', member, requiredRoleIds);
    if (hasPerms && hasPerms.data) {
      await interaction.reply({ embeds: [hasPerms], ephemeral: true });
      return;
    }

    const user: User | null = interaction.options.getUser('user');
    if (!user) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setDescription('**This user did not exist. Contact @Zacky if this is incorrect.**')
            .setColor(EmbedColor.FAIL),
        ],
        ephemeral: true,
      });
      return;
    }
    const playertag = interaction.options.getString('playertag') as string;

    await interaction.deferReply();
    const discordId = user.id;
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const { embed, components } = await linkUser(client, guild.id, discordId, playertag);
      await client.query('COMMIT');
      if (components && components.length > 0) {
        // Convert builder instances to raw JSON data for Discord API
        const rawComponents = components.map((c) => c.toJSON());
        await interaction.editReply({ embeds: [embed], components: rawComponents }); // If need to relink
      } else {
        const oldFooter = embed.data.footer?.text ?? '';
        if (oldFooter.length > 1) {
          embed.setFooter({ text: oldFooter, iconURL: user.displayAvatarURL() });
        }
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      await client.query('ROLLBACK');
      console.log(error);
      await interaction.editReply({ content: `There was an error with linking: ${error}` });
      return;
    } finally {
      client.release();
    }
  },
};

export default command;
