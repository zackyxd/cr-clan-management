import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ChatInputCommandInteraction,
  MessageFlags,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  EmbedBuilder,
} from 'discord.js';
import pool from '../../db.js';
import logger from '../../logger.js';
import { Command } from '../../types/Command.js';
import { makeCustomId } from '../../utils/customId.js';
import { BOTCOLOR, EmbedColor } from '../../types/EmbedUtil.js';
import { clanEmbedCache } from '../../cache/clanEmbedCache.js';
import { buildClanSettingsView } from '../../interactions/buttons/clanSettingsButton.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('clan-settings')
    .setDescription('Change clan settings for linked clans')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('clan-abbreviation').setDescription('Quickly go to a specific clan.').setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({ content: '❌ This command must be used in a server.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply();

    const clanArg = interaction.options.getString('clan');

    let components;
    let embed;

    if (clanArg) {
      // Show selected clan directly
      const clanRes = await pool.query(
        `
        SELECT clantag, clan_name
        FROM clans
        WHERE guild_id = $1 AND abbreviation = $2
        `,
        [guild.id, clanArg]
      );
      const row = clanRes.rows[0];

      if (!row) {
        const embed = new EmbedBuilder()
          .setDescription(`❌ Clan with abbreviation \`${clanArg}\` not found. Please assign it manually first.`)
          .setColor(EmbedColor.FAIL);
        await interaction.editReply({ embeds: [embed] });
        return;
      }
      const selectMenu = await buildClanSelectMenu(guild.id, interaction.user.id, interaction.id);
      ({ embed, components } = await buildClanSettingsView(guild.id, row.clan_name, row.clantag, interaction.user.id));

      // Make sure selectMenu is wrapped inside an ActionRow
      const selectMenuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

      // Merge the select menu row(s) at the end
      const mergedComponents = [...components, selectMenuRow];

      await interaction.editReply({
        embeds: [embed],
        components: mergedComponents,
      });
    } else {
      // Show select menu
      const selectMenu = await buildClanSelectMenu(guild.id, interaction.user.id, interaction.id);
      embed = new EmbedBuilder()
        .setTitle('Select a clan to manage')
        .setColor(BOTCOLOR)
        .setDescription('Use the select menu below to choose a clan.');
      components = [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)];
      await interaction.editReply({ embeds: [embed], components });
    }
  },
};

export async function buildClanSelectMenu(guildId: string, ownerId: string, interactionId: string) {
  const res = await pool.query(
    `
    SELECT c.clantag, c.clan_name, c.family_clan, cs.settings
    FROM clans c
    LEFT JOIN clan_settings cs
    ON c.guild_id = cs.guild_id AND c.clantag = cs.clantag
    WHERE c.guild_id = $1
    `,
    [guildId]
  );

  if (!res || !res.rows || res.rows.length === 0) {
    logger.warn(`clanSettings.ts: No clans found for this guild: ${guildId}`);
    return new StringSelectMenuBuilder()
      .setCustomId(makeCustomId('select', 'clan', guildId, { ownerId }))
      .setPlaceholder('No clans linked! Use /add-clans')
      .setDisabled(true)
      .addOptions([
        {
          label: 'No clans available',
          value: 'no_clans',
          description: 'No clans are linked to this server.',
        },
      ]);
  }

  const familyClans = res.rows.filter((clan) => clan.family_clan);
  const nonFamilyClans = res.rows.filter((clan) => !clan.family_clan);

  familyClans.sort((a, b) => b.clan_trophies - a.clan_trophies);
  nonFamilyClans.sort((a, b) => b.clan_trophies - a.clan_trophies);

  const clans = [...familyClans, ...nonFamilyClans];

  const options = clans.map((clan) => ({
    label: clan.clan_name,
    description: clan.clantag,
    value: JSON.stringify({ clantag: clan.clantag, clanName: clan.clan_name }), // <--- both values
  }));

  const embedMap = new Map<string, EmbedBuilder>();

  for (const clan of clans) {
    try {
      const { embed } = await buildClanSettingsView(guildId, clan.clan_name, clan.clantag, ownerId);
      embedMap.set(clan.clantag, embed);
    } catch (error) {
      logger.warn(`No settings found for clan ${clan.clantag} in clanSettings.ts`, error);
      embedMap.set(
        clan.clantag,
        new EmbedBuilder()
          .setTitle(`Clan Settings: ${clan.clan_name}`)
          .setDescription('No settings found for this clan.')
          .setColor(EmbedColor.FAIL)
      );
    }
  }

  // Store in cache if interactionId is provided
  if (interactionId) {
    clanEmbedCache.set(interactionId, embedMap);
    setTimeout(() => clanEmbedCache.delete(interactionId), 5 * 60 * 1000);
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(makeCustomId('select', 'clan', guildId, { ownerId }))
    .setPlaceholder('Select a clan')
    .addOptions(options);

  return selectMenu;
}

export default command;
