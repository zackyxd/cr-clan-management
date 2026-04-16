import { ChatInputCommandInteraction, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { pool } from '../../db.js';
import { normalizeTag } from '../../api/CR_API.js';
import { Command } from '../../types/Command.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('delete-clan')
    .setDescription('(Management) Unlink a clan from your server')
    .addStringOption((option) => option.setName('clantag').setDescription('#ABC123').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    const userId = interaction.user.id;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;

    const clantag = interaction.options.getString('clantag') as string;

    const normalizedTag = normalizeTag(clantag);
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const result = await client.query(
        `DELETE FROM clans WHERE guild_id = $1 AND (clantag = $2 OR abbreviation = LOWER($3))`,
        [guild.id, normalizedTag, clantag],
      );
      if (result.rowCount === 0) {
        await interaction.editReply({
          content: `❌ No clan found with tag or abbreviation **${clantag}**.`,
        });
        await client.query('ROLLBACK');
        return;
      }
      await client.query('COMMIT');
      await interaction.editReply({
        content: `✅ Clan with tag or abbreviation **${clantag}** has been unlinked.`,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};

export default command;
