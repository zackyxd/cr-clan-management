import {
  ButtonInteraction,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { makeCustomId, parseCustomId } from '../../utils/customId.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { getClanSettingsData } from '../../cache/clanSettingsDataCache.js';
import { memberChannelCache } from '../../cache/memberChannelCache.js';

export default {
  customId: 'open_modal',
  async execute(interaction: ButtonInteraction) {
    const { guildId, extra } = parseCustomId(interaction.customId);
    const cacheKey = extra[0];
    // Try to get data from cache (for clan settings)
    const settingsData = getClanSettingsData(cacheKey);
    console.log(cacheKey, settingsData);

    // If we have cache data, use it; otherwise treat as legacy action
    const action = settingsData?.settingKey || cacheKey;
    console.log(action);
    // Ticket settings change text
    if (action === 'opened_identifier' || action === 'closed_identifier') {
      const allowed = await checkPerms(interaction, guildId, 'button', 'higher', {
        hideNoPerms: true,
        skipDefer: true,
      });
      if (!allowed) return;
      const modal = new ModalBuilder()
        .setCustomId(makeCustomId('m', action, guildId))
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
        .setCustomId(makeCustomId('m', action, guildId))
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

    // Clan invite update
    else if (action == 'update_invite') {
      const allowed = await checkPerms(interaction, guildId, 'button', 'either', {
        hideNoPerms: true,
        skipDefer: true,
      });
      if (!allowed) return;

      const modal = new ModalBuilder()
        .setCustomId(makeCustomId('m', action, guildId))
        .setTitle('Update Clan Invite')
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Paste Clan Invite')
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('input')
                .setStyle(TextInputStyle.Short)
                .setMinLength(1)
                .setMaxLength(150)
            )
        );

      return interaction.showModal(modal);
    }
    // Category Ids Select
    else if (action === 'category_id') {
      const allowed = await checkPerms(interaction, guildId, 'button', 'higher', {
        hideNoPerms: true,
        skipDefer: true,
      });
      if (!allowed) return;

      const modal = new ModalBuilder()
        .setTitle('Set Category')
        .setCustomId(makeCustomId('m', action, guildId, { extra: [extra[1]] })) // extra 1 sending table name
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Category Select')
            .setChannelSelectMenuComponent(new ChannelSelectMenuBuilder().setCustomId('input').setMaxValues(1))
        );
      return interaction.showModal(modal);
    }

    // Logs channel setting
    else if (action === 'logs_channel_id') {
      const allowed = await checkPerms(interaction, guildId, 'button', 'higher', {
        hideNoPerms: true,
        skipDefer: true,
      });
      if (!allowed) return;
      console.log('table type for logs', extra[1]);

      const modal = new ModalBuilder()
        .setTitle('Set Logs Channel')
        .setCustomId(makeCustomId('m', action, guildId, { extra: [extra[1]] })) // extra 1 sending table name
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Channel Select')
            .setChannelSelectMenuComponent(new ChannelSelectMenuBuilder().setCustomId('input').setMaxValues(1))
        );
      return interaction.showModal(modal);
    }

    console.warn(`Unhandled open_modal settingKey: ${action}`);
  },
};
