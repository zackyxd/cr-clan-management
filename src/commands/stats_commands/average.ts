import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder, User } from 'discord.js';
import { Command } from '../../types/Command.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { pool } from '../../db.js';
import { getSpreadsheetId } from '../../features/stats/statsUtil.js';
import { getAveragesEntriesForTags } from '../../features/stats/averagesLookup.js';
import { buildAccountSelectRow, buildSummaryEmbed } from '../../features/stats/averagesEmbeds.js';
import { averagesDataCache } from '../../cache/averagesDataCache.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('average')
    .setDescription("Check a user's fame/attack averages from the 4k/5k Averages sheets")
    .addUserOption((option) =>
      option.setName('user').setDescription('The @user you would like to check').setRequired(true),
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const user: User | null = interaction.options.getUser('user');
    if (!user) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setDescription('**This user does not exist. Contact @Zacky if this is incorrect.**')
            .setColor(EmbedColor.FAIL),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();

    const playertagsQuery = await pool.query<{ playertag: string }>(
      `SELECT playertag FROM user_playertags WHERE guild_id = $1 AND discord_id = $2`,
      [guild.id, user.id],
    );

    if (playertagsQuery.rows.length === 0) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setDescription(`There were no playertags linked to <@${user.id}>.`)
            .setColor(EmbedColor.FAIL),
        ],
      });
      return;
    }

    const spreadsheetId = await getSpreadsheetId(guild.id);
    if (!spreadsheetId) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setDescription('❌ Stats spreadsheet is not configured for this server.')
            .setColor(EmbedColor.FAIL),
        ],
      });
      return;
    }

    const tags = playertagsQuery.rows.map((row) => row.playertag);
    const entries = await getAveragesEntriesForTags(spreadsheetId, tags);

    const displayName = user.globalName || user.username;
    const avatarURL = user.displayAvatarURL();
    const summaryEmbed = buildSummaryEmbed(displayName, avatarURL, entries);
    const selectRow = buildAccountSelectRow(guild.id, interaction.user.id, entries);

    await interaction.editReply({
      embeds: [summaryEmbed],
      components: selectRow ? [selectRow] : [],
    });

    if (entries.length > 0) {
      averagesDataCache.set(interaction.id, {
        discordId: user.id,
        displayName,
        avatarURL,
        entries: new Map(entries.map((entry) => [entry.key, entry])),
      });
    }

    // Remove components once the cache entry expires so select menu / buttons don't
    // stay clickable after they'd just show "session expired".
    setTimeout(
      async () => {
        try {
          await interaction.editReply({ components: [] });
        } catch (error) {
          // Message might have been deleted or interaction expired
          console.warn(`Could not remove components from /average command: ${error}`);
        }
      },
      2 * 60 * 1000,
    );
  },
};

export default command;
