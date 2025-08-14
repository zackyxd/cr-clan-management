import { ButtonInteraction, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

export default {
  customId: 'modal',
  async execute(interaction: ButtonInteraction, args: string[]) {
    console.log('Args from modal.ts', args);

    const [guildId, settingKey, isChannel] = args;
    if (settingKey === 'opened_identifier' || settingKey === 'closed_identifier') {
      const modal = new ModalBuilder()
        .setCustomId(`modal_submit:${guildId}:${settingKey}`)
        .setTitle(`Edit ${settingKey}`)
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId('input').setLabel('Enter new value').setStyle(TextInputStyle.Short)
          )
        );

      return interaction.showModal(modal); // ✅ No reply/defer before this
    }

    // guildId, settingKey = channelId, channelId = channel
    if (isChannel) {
      const modal = new ModalBuilder()
        .setCustomId(`modal_submit:${guildId}:${settingKey}:channel`)
        .setTitle('Paste your CR tags.')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('input')
              .setLabel('Separate multiple tags by spaces.')
              .setStyle(TextInputStyle.Short)
          )
        );
      return interaction.showModal(modal);
    }
  },
};
