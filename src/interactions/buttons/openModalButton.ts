import {
  ButtonInteraction,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  RoleSelectMenuBuilder,
} from 'discord.js';
import { makeCustomId, parseCustomId } from '../../utils/customId.js';
import { checkPerms } from '../../utils/checkPermissions.js';
import { getClanSettingsData } from '../../cache/clanSettingsDataCache.js';

export default {
  customId: 'open_modal',
  async execute(interaction: ButtonInteraction) {
    const { guildId, extra } = parseCustomId(interaction.customId);
    const cacheKey = extra[0];

    // Try to get data from cache (for clan settings)
    const settingsData = getClanSettingsData(cacheKey);

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

      // Get clantag from cache data or fallback to legacy extra[1]
      const clantag = settingsData?.clantag || extra[1];

      const modal = new ModalBuilder()
        .setTitle('Change Abbreviation')
        .setCustomId(makeCustomId('modal', action, guildId, { extra: [clantag] }))
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Select new abbreviation')
            .setDescription('1-10 characters')
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('input')
                .setStyle(TextInputStyle.Short)
                .setMinLength(1)
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

    // Setting clan role
    else if (action === 'clan_role_id') {
      const allowed = await checkPerms(interaction, guildId, 'button', 'higher', {
        hideNoPerms: true,
        skipDefer: true,
      });
      if (!allowed) return;

      // Get data from cache or fallback to legacy extra
      const clantag = settingsData?.clantag || extra[1];
      const clanName = settingsData?.clanName || extra[2];

      const modal = new ModalBuilder()
        .setTitle('Set Clan Role')
        .setCustomId(makeCustomId('modal', action, guildId, { extra: [clantag, clanName] }))
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Role Select')
            .setRoleSelectMenuComponent(new RoleSelectMenuBuilder().setCustomId('input').setMaxValues(1))
        );
      return interaction.showModal(modal);
    }

    console.warn(`Unhandled open_modal settingKey: ${action}`);
  },
};
