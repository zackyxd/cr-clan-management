import { ActionRowBuilder, ButtonBuilder } from '@discordjs/builders';
import { ButtonStyle, ComponentType, MessageFlags } from 'discord.js';

export const paginationCV2 = async (interaction, pages, time = 30 * 1000) => {
  try {
    if (!interaction || !pages) throw new Error(`[PAGINATION CV2] Invalid args`);

    await interaction.deferReply();
    console.log([pages], pages.length);
    if (pages.length === 1) {
      console.log('came in here');
      return await interaction.editReply({
        components: [pages],
        flags: MessageFlags.IsComponentsV2,
        withResponse: true,
      });
    }

    let index = 0;
    const first = new ButtonBuilder()
      .setCustomId('pageFirst')
      .setEmoji({ name: '⏪' })
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true);
    const last = new ButtonBuilder().setCustomId('pageLast').setEmoji({ name: '⏭️' }).setStyle(ButtonStyle.Primary);
    const prev = new ButtonBuilder()
      .setCustomId('pagePrev')
      .setEmoji({ name: '⬅️' })
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true);
    const next = new ButtonBuilder().setCustomId('pageNext').setEmoji({ name: '➡️' }).setStyle(ButtonStyle.Primary);

    const pageCount = new ButtonBuilder()
      .setCustomId('pageCount')
      .setLabel(`${index + 1}/${pages.length}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const buttons = new ActionRowBuilder().addComponents([first, prev, pageCount, next, last]);

    const msg = await interaction.editReply({
      components: [pages[0]],
      withResponse: true,
      flags: MessageFlags.IsComponentsV2,
    });

    const collector = await msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time,
    });

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id)
        return await i.reply({
          content: `Only **${interaction.user.username}** may use these buttons`,
          ephemeral: true,
        });
      await i.deferUpdate();

      if (i.customId === 'pageFirst') {
        index = 0;
        pageCount.setLabel(`${index + 1}/${pages.length}`);
      }

      if (i.customId === 'pagePrev') {
        if (index > 0) index--;
        pageCount.setLabel(`${index + 1}/${pages.length}`);
      } else if (i.customId === 'pageNext') {
        if (index < pages.length - 1) {
          index++;
          pageCount.setLabel(`${index + 1}/${pages.length}`);
        }
      } else if (i.customId === 'pageLast') {
        index = pages.length - 1;
        pageCount.setLabel(`${index + 1}/${pages.length}`);
      }

      if (index === 0) {
        first.setDisabled(true);
        prev.setDisabled(true);
      } else {
        first.setDisabled(false);
        prev.setDisabled(false);
      }

      if (index === pages.length - 1) {
        next.setDisabled(true);
        last.setDisabled(true);
      } else {
        next.setDisabled(false);
        last.setDisabled(false);
      }

      await msg.edit({
        components: [pages[index]], // Show the correct container per page
        flags: MessageFlags.IsComponentsV2,
        withResponse: true,
      });
      collector.resetTimer();
    });

    collector.on('end', async () => {
      await msg.edit({ components: [] }).catch((err) => {
        console.log(err);
      });
    });

    return msg;
  } catch (error) {
    console.log(error);
  }
};
