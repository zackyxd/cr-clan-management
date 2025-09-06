import { MessageFlags } from 'discord.js';
import pool from '../../db.js';
import { ModalHandler } from '../../types/Handlers.js';
import { buildFeatureEmbedAndComponents } from '../buttons/serverSettingsButton.js';

// When modal with action (column) of 'opened_identifier' is called,
// run this code to set the text of the identifier for tickets
const ticketOpenedIdentifier: ModalHandler = {
  customId: 'opened_identifier',
  async execute(interaction, parsed) {
    const { guildId, action } = parsed; // action will be "opened_identifier"
    const messageId = interaction.message?.id;
    console.log('cameh ere');
    if (!messageId) return;
    const message = await interaction.channel?.messages.fetch(messageId);
    if (!message) return;
    // logic for opened_identifier
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const newValue = interaction.fields.getTextInputValue('input').toLowerCase();
    await pool.query(
      `
      UPDATE ticket_settings SET ${action} = $1 WHERE guild_id = $2
      `,
      [newValue, guildId]
    );
    const { embed, components } = await buildFeatureEmbedAndComponents(
      guildId,
      interaction.user.id,
      'tickets',
      'Ticket features handles everything related to tickets and ensuring you can handle new members.'
    );
    await message.edit({ embeds: [embed], components });
    await interaction.editReply({ content: '✅ Updated successfully', embeds: [] });
  },
};

export default ticketOpenedIdentifier;
