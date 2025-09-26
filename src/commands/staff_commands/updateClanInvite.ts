import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { checkFeatureEnabled } from '../../utils/checkFeatureEnabled.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import pool from '../../db.js';
import { normalizeTag } from '../../api/CR_API.js';
import { EmbedColor } from '../../types/EmbedUtil.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('update-clan-invite')
    .setDescription('Update clan invites with new links')
    .addStringOption((option) =>
      option.setName('invite-link').setDescription('Copy and paste the clan invite here').setRequired(true)
    ),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    const check = await checkFeatureEnabled(guild.id, 'clan_invites');
    if (!check.enabled) {
      if (check.embed) {
        await interaction.reply({ embeds: [check.embed], flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({
          content: 'Error showing embed for feature not enabled. Contact @Zacky',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    const allowed = await checkPerms(interaction, guild.id, 'button', 'either', {
      hideNoPerms: true,
      deferEphemeral: true,
    });
    if (!allowed) return;

    const inviteLink = interaction.options.getString('invite-link')?.trim();
    if (!inviteLink) return;
    const regex = /\/invite\/.*tag=([^&]*)/;
    const regexLink =
      /https:\/\/link\.clashroyale\.com\/invite\/clan\/[a-z]{2}\?tag=[^&]*&token=[^&]*&platform=(android|iOS)/;
    const match = inviteLink.match(regex); // gets the clantag
    const apiLink = inviteLink.match(regexLink); // gets the entire link
    if (match === null || match[1] === undefined || apiLink === null) {
      console.log('not valid');
      return;
    }
    // match
    //  [
    // '/invite/clan/du?tag=V2GQU',
    // 'V2GQU',
    // index: 36,
    // input: '[V2GQU](https://link.clashroyale.com/invite/clan/du?tag=V2GQU&token=6666666&platform=iOS)',
    // groups: undefined
    //  ]

    // apiLink
    //   [
    // 'https://link.clashroyale.com/invite/clan/du?tag=V2GQU&token=6666666&platform=iOS',
    // 'iOS',
    // index: 8,
    // input: '[V2GQU](https://link.clashroyale.com/invite/clan/du?tag=V2GQU&token=6666666&platform=iOS)',
    // groups: undefined
    //   ]

    const givenClantag = normalizeTag(match[1]);

    const { rows } = await pool.query(
      `
      SELECT clan_name
      FROM clans
      WHERE guild_id = $1
        AND clantag = $2
      LIMIT 1
      `,
      [interaction.guild.id, givenClantag]
    );

    if (rows.length === 0) {
      const embed = new EmbedBuilder()
        .setDescription(`❌ This clantag was not part of your linked clans. Add it using \`/add-clan\``)
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const clanName = rows[0].clan_name;

    const update = await pool.query(
      `
      UPDATE clans
      SET active_clan_link = $1, active_clan_link_expiry_time = NOW() + interval '3 days'
      WHERE guild_id = $2
        AND clantag = $3
      RETURNING active_clan_link_expiry_time;
      `,
      [apiLink[0], interaction.guild.id, givenClantag]
    );

    if (update.rowCount === 0) {
      const embed = new EmbedBuilder()
        .setDescription(`❌ This invite link was unable to be updated in the db. Contact @Zacky`)
        .setColor(EmbedColor.FAIL);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const expiresAt = update.rows[0].active_clan_link_expiry_time;
    const expiresAtUnix = Math.floor(new Date(expiresAt).getTime() / 1000);
    const embed = new EmbedBuilder()
      .setDescription(
        `✅ Successfully added the new invite link for **${clanName}**.\nIt will expire <t:${expiresAtUnix}:R>`
      )
      .setColor(EmbedColor.SUCCESS);
    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
