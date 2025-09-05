import { EmbedBuilder, GuildMember, MessageFlags } from 'discord.js';
import pool from '../../db.js';
import { buildCheckHasRoleQuery, checkPermissions } from '../../utils/check_has_role.js';
import { buildFindLinkedDiscordId, buildUpsertRelinkPlayertag } from '../../sql_queries/users.js';
import { CR_API } from '../../api/CR_API.js';
import { formatPlayerData } from '../../api/FORMAT_DATA.js';
import logger from '../../logger.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { ButtonHandler } from '../../types/Handlers.js';

const relinkUserButton: ButtonHandler = {
  customId: 'relinkUser',
  async execute(interaction, parsed) {
    await interaction.deferUpdate();
    const { guildId, extra } = parsed;
    const [originalDiscordId, playertag] = extra;

    const member = (await interaction.guild?.members.fetch(interaction.user.id)) as GuildMember;
    const getRoles = await pool.query(buildCheckHasRoleQuery(guildId));
    const { lower_leader_role_id, higher_leader_role_id } = getRoles.rows[0] ?? [];
    const requiredRoleIds = [lower_leader_role_id, higher_leader_role_id].filter(Boolean) as string[];
    const hasPerms = checkPermissions('button', member, requiredRoleIds);
    if (hasPerms && hasPerms.data) {
      await interaction.followUp({ embeds: [hasPerms], flags: MessageFlags.Ephemeral });
      return;
    }

    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      // Old account
      const currentDiscordIdQuery = await client.query(buildFindLinkedDiscordId(guildId, playertag));
      const currentDiscordId = currentDiscordIdQuery.rows[0].discord_id; // Get Id before it's changed

      // New account
      const relinkQuery = buildUpsertRelinkPlayertag(guildId, originalDiscordId, playertag); // Original Discord Id is the new discord account we will link to
      const relinkRes = await client.query(relinkQuery); // Relink to new discord id
      const newDiscordId = relinkRes.rows[0].new_discord_id;
      if (currentDiscordId !== newDiscordId) {
        const playerData = await CR_API.getPlayer(playertag);
        if ('error' in playerData) {
          await interaction.editReply({
            content: `⚠️ Could not fetch data for ${playertag}: ${playerData.error}`,
            components: [],
          });
          return; // exit the handler
        }
        const playerEmbed = formatPlayerData(playerData);
        if (!playerEmbed) {
          await interaction.editReply({ content: 'There was an error with showing player data', components: [] });
          return;
        }
        const getUser = await interaction.guild?.members.fetch(newDiscordId);
        playerEmbed?.setFooter({ text: `Relinked | ${playertag}`, iconURL: getUser?.displayAvatarURL() });
        await interaction.editReply({ embeds: [playerEmbed], components: [] });
        await interaction.followUp({
          content: `The playertag \`${playertag}\` has been relinked from <@${currentDiscordId}> → <@${newDiscordId}>`,
          flags: MessageFlags.Ephemeral,
        });
        try {
          if (!interaction || !interaction.guild) {
            return;
          }
          const renameEnabled = await pool.query(
            `
            SELECT rename_players
            FROM linking_settings
            WHERE guild_id = $1
            `,
            [interaction.guild.id]
          );
          if (renameEnabled.rows[0]['rename_players']) {
            // Fetch the member from the guild
            const member: GuildMember | null = await interaction.guild.members.fetch(newDiscordId).catch(() => null);

            if (!member) {
              await interaction.reply({
                embeds: [
                  new EmbedBuilder().setDescription('**This user is not in this server.**').setColor(EmbedColor.FAIL),
                ],
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            await member.setNickname(playerData.name);
          }
        } catch (error) {
          await interaction.followUp({ content: `Could not rename this player.`, flags: MessageFlags.Ephemeral });
          logger.info(error);
        }
        await client.query('COMMIT');
      } else {
        await client.query('ROLLBACK');
        await interaction.editReply({
          content: `There was an error with relinking...try again or contact @Zacky`,
          components: [],
        });
      }
    } catch (error) {
      console.log(error);
      await client.query('ROLLBACK');
      await interaction.followUp(`Error with relinking: ${error}`);
      return;
    } finally {
      client.release();
    }
  },
};
export default relinkUserButton;
