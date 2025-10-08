import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { pool } from '../../db.js';
import { Command } from '../../types/Command.js';
import { normalizeTag } from '../../api/CR_API.js';
import { buildFindMember } from '../../sql_queries/users.js';
import { BOTCOLOR, EmbedColor } from '../../types/EmbedUtil.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('find-member')
    .setDescription(`Find a member's @user given their playertag`)
    .addStringOption((option) =>
      option.setName('playertag').setDescription('#ABC123').setMinLength(4).setMaxLength(13).setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    let playertag = interaction.options.getString('playertag') as string;
    playertag = normalizeTag(playertag);
    await interaction.deferReply();
    const playerRes = await pool.query(buildFindMember(guild.id, playertag));
    const foundDiscordUserId = playerRes?.rows[0]?.discord_id ?? null;
    if (!foundDiscordUserId) {
      const embed = new EmbedBuilder()
        .setDescription(`**There was no one linked to this playertag \`${playertag}\`**`)
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    const getUser = await interaction.guild?.members.fetch(foundDiscordUserId);
    const embed = new EmbedBuilder()
      .setDescription(
        `**<@${foundDiscordUserId}> (${getUser.displayName}) is linked to this playertag \`${playertag}\`**`
      )
      .setColor(BOTCOLOR);
    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
