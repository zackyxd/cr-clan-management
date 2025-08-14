import { ButtonInteraction, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

export default {
  customId: 'modal',
  async execute(interaction: ButtonInteraction, args: string[]) {
    const [guildId, settingKey] = args;

    const modal = new ModalBuilder()
      .setCustomId(`modal_submit:${guildId}:${settingKey}`)
      .setTitle(`Edit ${settingKey}`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('input').setLabel('Enter new value').setStyle(TextInputStyle.Short)
        )
      );

    return interaction.showModal(modal); // ✅ No reply/defer before this
  },
};
