import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  MessageFlags,
  SlashCommandBuilder,
  User,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { linkUser } from '../../services/users.js';
import { pool } from '../../db.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import logger from '../../logger.js';
import { checkFeature, checkLinkFeatureEnabled } from '../../utils/checkFeatureEnabled.js';

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
    // const userId = interaction.user.id;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const featureCheck = await checkFeature(interaction, guild.id, 'links');
    if (!featureCheck) {
      return;
    }

    // TODO figure out if possible to not ephemeral if successful link, but still show
    const allowed = await checkPerms(interaction, guild.id, 'command', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;

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
    const playertag = interaction.options.getString('playertag') as string;

    // await interaction.deferReply();
    const discordId = user.id;
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const { embed, player_name, components } = await linkUser(client, guild.id, discordId, playertag);
      if (components && components.length > 0) {
        // Convert builder instances to raw JSON data for Discord API
        const rawComponents = components.map((c) => c.toJSON());
        await interaction.editReply({ embeds: [embed], components: rawComponents }); // If need to relink
        await client.query('COMMIT');
      } else {
        // If new link
        const oldFooter = embed.data.footer?.text ?? '';
        if (oldFooter.length > 1) {
          embed.setFooter({ text: oldFooter, iconURL: user.displayAvatarURL() });
        }
        await interaction.editReply({ embeds: [embed] });
        await client.query('COMMIT');
        // Try to rename if feature enabled
        try {
          const renameEnabled = await checkLinkFeatureEnabled(guild.id, 'rename_players');
          if (renameEnabled.enabled) {
            if (player_name) {
              // Fetch the member from the guild
              const member: GuildMember | null = await interaction.guild.members.fetch(user.id).catch(() => null);

              if (!member) {
                await interaction.reply({
                  embeds: [
                    new EmbedBuilder().setDescription('**This user is not in this server.**').setColor(EmbedColor.FAIL),
                  ],
                  flags: MessageFlags.Ephemeral,
                });
                return;
              }
              await member.setNickname(player_name);
            }
          }
        } catch (error) {
          await interaction.followUp({ content: `Could not rename this player.`, flags: MessageFlags.Ephemeral });
          logger.info(error);
        }
      }
    } catch (error) {
      await client.query('ROLLBACK');
      console.log(`error from link.ts`, error);
      await interaction.editReply({ content: `There was an error with linking: ${error}` });
      return;
    } finally {
      client.release();
    }
  },
};

export default command;
