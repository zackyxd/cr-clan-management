import { ButtonInteraction, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { makeCustomId, parseCustomId } from '../../utils/customId.js';

export default {
  customId: 'open_modal',
  async execute(interaction: ButtonInteraction) {
    const { guildId, extra } = parseCustomId(interaction.customId);
    const action = extra[0];
    if (action === 'opened_identifier' || action === 'closed_identifier') {
      const modal = new ModalBuilder()
        .setCustomId(makeCustomId('modal', action, guildId))
        .setTitle(`Edit ${action}`)
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId('input').setLabel('Enter new value').setStyle(TextInputStyle.Short)
          )
        );

      return interaction.showModal(modal); // ✅ No reply/defer before this
    }

    // Ticket channel playertags
    else if (action === 'ticket_channel') {
      const modal = new ModalBuilder()
        .setCustomId(makeCustomId('modal', action, guildId))
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

    console.warn(`Unhandled modal settingKey: ${action}`);
  },
};
