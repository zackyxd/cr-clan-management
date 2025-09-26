import {
  ActionRow,
  ActionRowBuilder,
  ComponentType,
  MessageActionRowComponent,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from 'discord.js';
import { buildClanSettingsView } from '../buttons/clanSettingsButton.js';
import { checkPerms } from '../../utils/checkPermissions.js';

export default {
  customId: 'clan',
  async execute(interaction: StringSelectMenuInteraction) {
    if (!interaction || !interaction.guild) return;

    // TODO check if this is right
    const allowed = await checkPerms(interaction, interaction.guild.id, 'select menu', 'either', { hideNoPerms: true });
    if (!allowed) return; // no perms

    const { clantag, clanName } = JSON.parse(interaction.values[0]);
    const guildId = interaction.guildId!;
    const ownerId = interaction.user.id;
    console.log(`Currently checking out ${clanName}`);
    // Rebuild the select menu row as a builder
    const oldSelectMenuRow = interaction.message.components.find(
      (row): row is ActionRow<MessageActionRowComponent> =>
        row.type === ComponentType.ActionRow && row.components.some((c) => c.type === ComponentType.StringSelect)
    );

    let selectMenuRowBuilder: ActionRowBuilder<StringSelectMenuBuilder> | null = null;
    if (oldSelectMenuRow) {
      const selectMenu = oldSelectMenuRow.components.find((c) => c.type === ComponentType.StringSelect);
      if (selectMenu?.type === ComponentType.StringSelect) {
        selectMenuRowBuilder = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          StringSelectMenuBuilder.from(selectMenu)
        );
      }
    }
    const { embed, components: buttonRows } = await buildClanSettingsView(guildId, clanName, clantag, ownerId);

    // Update the message with the new embed and buttons
    await interaction.editReply({
      embeds: [embed],
      components: selectMenuRowBuilder ? [...buttonRows, selectMenuRowBuilder] : buttonRows,
    });
  },
};
