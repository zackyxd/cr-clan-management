import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  User,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { pool } from '../../db.js';
import fastq from 'fastq';
import { CR_API, FetchError, isFetchError, PlayerResult } from '../../api/CR_API.js';
import { formatPlayerData } from '../../api/FORMAT_DATA.js';
import { playerEmbedCache } from '../../cache/playerEmbedCache.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('players')
    .setDescription("Check out a player's linked accounts in a server")
    .addUserOption((option) =>
      option.setName('user').setDescription('The @user you would like to check').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Grab user, even if not in guild
    const user: User | null = interaction.options.getUser('user');
    if (!user) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setDescription('**This user did not exist. Contact @Zacky if this is incorrect.**')
            .setColor(EmbedColor.FAIL),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    const discordId = user.id;
    const userPlayertagsQuery = await pool.query(
      `
      SELECT playertag 
      FROM user_playertags
      WHERE guild_id = $1
      AND discord_id = $2
      `,
      [guild.id, discordId]
    );

    const playertagData = userPlayertagsQuery.rows;
    if (playertagData.length === 0) {
      const emptyTagsEmbed = new EmbedBuilder()
        .setDescription(`There were no playertags linked to <@${discordId}>.`)
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [emptyTagsEmbed] });
      return;
    }

    // Set concurrency to x at a time
    // TODO Fix since api client handles limits
    const queue = fastq.promise(fetchPlayerWorker, 5);

    // Add all playertags to queue and collect results
    const results: (PlayerResult | FetchError)[] = await Promise.all(
      playertagData.map((row) => queue.push(row.playertag))
    );
    // Sort by expLevel -> Name
    results.sort((a, b) => {
      const aLevel = 'error' in a ? 0 : a.expLevel;
      const bLevel = 'error' in b ? 0 : b.expLevel;

      if (bLevel !== aLevel) return bLevel - aLevel;

      const aName = 'error' in a ? a.tag ?? '' : a.name;
      const bName = 'error' in b ? b.tag ?? '' : b.name;

      return aName.localeCompare(bName);
    });

    // console.log(results);

    const select = new StringSelectMenuBuilder()
      .setCustomId(`players:${interaction.user.id}`)
      .setPlaceholder('Select a player');

    const embedMap = new Map<string, EmbedBuilder>();
    let firstEmbed: EmbedBuilder | undefined;
    for (const player of results) {
      if (!('error' in player)) {
        const embed = formatPlayerData(player);

        if (embed) {
          embed.setFooter({
            text: `${user.globalName || user.username} | ${player.tag}`,
            iconURL: user.displayAvatarURL(),
          });
          if (!firstEmbed) firstEmbed = embed;
          embedMap.set(player.tag, embed);
          select.addOptions(
            new StringSelectMenuOptionBuilder().setLabel(player.name).setDescription(player.tag).setValue(player.tag)
          );
        }
      } else {
        // player is a FetchError here
        if (isFetchError(player)) {
          if (player.embed) {
            embedMap.set(player.tag ?? player.reason ?? 'unknown', player.embed);
            select.addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel(player.reason || 'Error')
                .setDescription(player.tag || 'Unknown')
                .setValue(player.tag ?? player.reason ?? 'unknown')
            );
            if (!firstEmbed) firstEmbed = player.embed;
          }
        }
      }
    }
    playerEmbedCache.set(interaction.id, embedMap);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
    // TODO fix needing firstEmbed to do this, it should always exist
    if (!firstEmbed) {
      const noFirstEmbed = new EmbedBuilder()
        .setDescription(`Error showing the first player on the list. Contact Zacky`)
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [noFirstEmbed] });
      return;
    }
    await interaction.editReply({ embeds: [firstEmbed], components: [row] });

    // Remove components after 5 minutes so select menu doesn't stay forever
    setTimeout(async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch (error) {
        // Message might have been deleted or interaction expired
        console.warn(`Could not remove components from /players command: ${error}`);
      }
    }, 5 * 60 * 1000);
  },
};

async function fetchPlayerWorker(playertag: string) {
  return CR_API.getPlayer(playertag);
}

export default command;
