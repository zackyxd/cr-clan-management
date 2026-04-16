import { SlashCommandBuilder, ChatInputCommandInteraction, MessageFlags, EmbedBuilder } from 'discord.js';
import { getCurrentRiverRace, isFetchError, normalizeTag } from '../../api/CR_API.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';
import {
  detectSeasonId,
  getRaceStats,
  initializeOrUpdateRace,
  updateParticipantTracking,
} from '../../features/race-tracking/service.js';
import { BOTCOLOR } from '../../types/EmbedUtil.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('race')
    .setDescription('Check the race of this clan')
    .addStringOption((option) => option.setName('clantag').setDescription('#ABC123').setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();
    const userInput = interaction.options.getString('clantag') as string;
    const normalizedTag = normalizeTag(userInput);

    const clanRes = await pool.query(
      `SELECT clantag FROM clans WHERE guild_id = $1 AND (clantag = $2 OR LOWER(abbreviation) = LOWER($3))`,
      [guild.id, normalizedTag, userInput],
    );

    const fixedClantag = clanRes.rows.length > 0 ? clanRes.rows[0].clantag : normalizedTag;

    const result = await initializeOrUpdateRace(guild.id, fixedClantag);
    if (!result) {
      await interaction.editReply('❌ Failed to fetch race data. Please try again later.');
      return;
    }

    const { raceId, raceData, seasonId, warDay, warWeek, periodType } = result;
    const stats = getRaceStats(guild.id, raceData);

    if (!stats) {
      await interaction.editReply('❌ Failed to compute race stats. Please try again later.');
      return;
    }

    if (stats.type === 'training') {
      // TODO add emojis
      const embed = new EmbedBuilder()
        .setTitle(`Training Day`)
        .setColor(BOTCOLOR)
        .setURL(`https://cwstats.com/clan/${normalizedTag.substring(1)}/race`)
        .setAuthor({
          name: `W${warWeek} D${warDay} S${seasonId || '---'}`,
        });
      let description = '';
      console.log(stats.clans);

      stats.clans.forEach((clan, index) => {
        const escapedName = escapeMarkdown(clan.name);
        const clantag = clan.clantag.substring(1); // Remove #

        if (clan.clantag === fixedClantag) {
          description += `__**${index + 1}. [${escapedName}](<https://www.cwstats.com/clan/${clantag}/log>)**__\n`;
        } else {
          description += `**${index + 1}. [${escapedName}](<https://www.cwstats.com/clan/${clantag}/log>)**\n`;
        }
      });

      embed.setDescription(description);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (stats.type === 'warDay') {
      // TODO add emojis
      const embed = new EmbedBuilder()
        .setTitle(`War Day`)
        .setColor(BOTCOLOR)
        .setURL(`https://cwstats.com/clan/${normalizedTag.substring(1)}/race`)
        .setAuthor({ name: `W${warWeek} D${warDay} S${seasonId || '---'}` });
      let description = '';
      stats.clans.forEach((clan, index) => {
        const escapedName = escapeMarkdown(clan.name);
        const clantag = clan.clantag.substring(1); // Remove #

        if (clan.clantag === fixedClantag) {
          description += `${index + 1}. __**[${escapedName}](<https://www.cwstats.com/clan/${clantag}/log>)**__\n`;
        } else {
          description += `${index + 1}. **[${escapedName}](<https://www.cwstats.com/clan/${clantag}/log>)**\n`;
        }
        // TODO emoji
        const average: string = (clan.fame / clan.attacksUsedToday).toFixed(2);
        const projectedFameRaw = clan.fame + Math.round((200 - clan.attacksUsedToday) * Number(average));
        const projectedFame = Math.round(projectedFameRaw / 50) * 50;
        description += `:fame: ${clan.fame.toLocaleString()}\n`;
        description += `:projected: ${projectedFame.toLocaleString()}\n`;
        description += `:attacksLeft: ${200 - clan.attacksUsedToday}\n`;
        description += `:average: ${average ? average : '-1'}\n\n`;
      });
      console.log(description);
      embed.setDescription(description);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (stats.type === 'colosseum') {
      // TODO add emojis
      const embed = new EmbedBuilder()
        .setTitle('Colosseum')
        .setColor(BOTCOLOR)
        .setURL(`https://cwstats.com/clan/${normalizedTag.substring(1)}/race`)
        .setAuthor({ name: `W${warWeek} D${warDay} S${seasonId || '---'}` });
      let description = '';
      stats.clans.forEach((clan, index) => {
        const escapedName = escapeMarkdown(clan.name);
        const clantag = clan.clantag.substring(1); // Remove #

        if (clan.clantag === fixedClantag) {
          description += `${index + 1}. __**[${escapedName}](<https://www.cwstats.com/clan/${clantag}/log>)**__\n`;
        } else {
          description += `${index + 1}. **[${escapedName}](<https://www.cwstats.com/clan/${clantag}/log>)**\n`;
        }

        let totalDecksUsed: number = 0;
        if (warDay !== 1) {
          totalDecksUsed = warDay * 200 - 200;
        }
        const average: string = (clan.fame / (clan.attacksUsedToday + totalDecksUsed)).toFixed(2);
        const projectedFameRaw =
          clan.fame +
          Math.round(200 * (4 - warDay) * Number(average)) +
          Math.round((200 - clan.attacksUsedToday) * Number(average));
        const projectedFame = Math.round(projectedFameRaw / 50) * 50;
        description += `:fame: ${clan.fame.toLocaleString()}\n`;
        description += `:projected: ${projectedFame.toLocaleString()}\n`;
        description += `:attacksLeft: ${200 - clan.attacksUsedToday}\n`;
        description += `:average: ${average ? average : '-1'}\n\n`;
      });
      console.log(description);
      embed.setDescription(description);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    await interaction.editReply({ content: 'You should not get this...' });
  },
};

function escapeMarkdown(text: string): string {
  const markdownCharacters = ['*', '_', '`', '~'];
  return text
    .split('')
    .map(function (character: string) {
      if (markdownCharacters.includes(character)) {
        return '\\' + character;
      }
      return character;
    })
    .join('');
}

export default command;
