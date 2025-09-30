import { ButtonInteraction, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { makeCustomId, parseCustomId } from '../../utils/customId.js';
import { checkPerms } from '../../utils/checkPermissions.js';

export default {
  customId: 'open_modal',
  async execute(interaction: ButtonInteraction) {
    const { guildId, extra } = parseCustomId(interaction.customId);
    const action = extra[0];
    console.log(action);
    // Ticket settings change text
    if (action === 'opened_identifier' || action === 'closed_identifier') {
      const allowed = await checkPerms(interaction, guildId, 'button', 'higher', {
        hideNoPerms: true,
        skipDefer: true,
      });
      if (!allowed) return;
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
      const allowed = await checkPerms(interaction, guildId, 'button', 'higher', {
        hideNoPerms: true,
        skipDefer: true,
      });
      if (!allowed) return;
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

    // clan settings change abbreviation
    else if (action === 'abbreviation') {
      // Can't ephemeral modals
      // TODO if user can see these buttons, but loses permissions, it skips the defer from 'true', so cant reply
      const allowed = await checkPerms(interaction, guildId, 'button', 'higher', {
        hideNoPerms: true,
        skipDefer: true,
      });
      if (!allowed) return;
      const clantag = extra[1];
      const modal = new ModalBuilder()
        .setCustomId(makeCustomId('modal', action, guildId, { extra: [clantag] }))
        .setTitle('Which abbreviation do you want to use?')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('input')
              .setLabel('Max 10 characters')
              .setStyle(TextInputStyle.Short)
              .setMaxLength(10)
          )
        );
      return interaction.showModal(modal);
    }

    // Clan invite update
    else if (action == 'update_invite') {
      const allowed = await checkPerms(interaction, guildId, 'button', 'either', {
        hideNoPerms: true,
        skipDefer: true,
      });
      if (!allowed) return;

      const modal = new ModalBuilder()
        .setCustomId(makeCustomId('modal', action, guildId))
        .setTitle('Clan Invite.')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setLabel('Paste the clan invite.')
              .setCustomId('input')
              .setStyle(TextInputStyle.Short)
          )
        );
      return interaction.showModal(modal);
    }

    console.warn(`Unhandled open_modal settingKey: ${action}`);
  },
};
