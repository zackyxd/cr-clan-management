import {
  ButtonInteraction,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  GuildMember,
  MessageFlags,
} from 'discord.js';
import { makeCustomId, parseCustomId } from '../../utils/customId.js';
import pool from '../../db.js';
import { buildCheckHasRoleQuery, checkPermissions, checkPerms } from '../../utils/checkPermissions.js';

export default {
  customId: 'open_modal',
  async execute(interaction: ButtonInteraction) {
    const { guildId, extra } = parseCustomId(interaction.customId);
    const action = extra[0];
    const member = (await interaction.guild?.members.fetch(interaction.user.id)) as GuildMember;
    const getRoles = await pool.query(buildCheckHasRoleQuery(guildId));
    const { lower_leader_role_id, higher_leader_role_id } = getRoles.rows[0] ?? [];

    // Ticket settings change text
    if (action === 'opened_identifier' || action === 'closed_identifier') {
      const requiredRoleIds = [higher_leader_role_id].filter(Boolean) as string[];
      const hasPerms = checkPermissions('button', member, requiredRoleIds);
      if (hasPerms && hasPerms.data) {
        // Returns Promise<Message>, ButtonHandler.execute handled for Promise<void> so await -> return
        await interaction.followUp({ embeds: [hasPerms], flags: MessageFlags.Ephemeral });
        return;
      }
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

    // clan settings change abbreviation
    else if (action === 'abbreviation') {
      // Can't ephemeral modals
      // TODO if user can see these buttons, but loses permissions, it skips the defer from 'true', so cant reply
      const allowed = await checkPerms(interaction, guildId, 'button', 'higher', false, true);
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

    console.warn(`Unhandled open_modal settingKey: ${action}`);
  },
};
