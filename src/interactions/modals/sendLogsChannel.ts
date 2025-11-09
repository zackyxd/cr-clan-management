import { MessageFlags } from 'discord.js';
import { pool } from '../../db.js';
import { ModalHandler } from '../../types/Handlers.js';
import { buildFeatureEmbedAndComponents } from '../../config/serverSettingsBuilder.js';

// When modal with action (column) of 'closed_identifier' is called,
// run this code to set the text of the identifier for tickets
const sendLogsIdentifier: ModalHandler = {
  customId: 'logs_channel_id',
  async execute(interaction, parsed) {
    const { guildId, action, extra } = parsed; // action will be "logs_channel_id"
    const messageId = interaction.message?.id;
    if (!messageId) return;
    const message = await interaction.channel?.messages.fetch(messageId);
    if (!message) return;
    // logic for closed_identifier
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // Get the selected channel(s) from the modal field
    const channelField = interaction.fields.getSelectedChannels('input'); // or your customId
    if (!channelField || channelField.size === 0) {
      await interaction.editReply({ content: 'No channel selected.', embeds: [] });
      return; // ✅ Add explicit return
    }
    const selectedChannel = channelField.first(); // Get the first selected channel's ID
    // Check if the selected channel is a text channel
    if (selectedChannel && selectedChannel.type !== 0 && selectedChannel.type !== 5) {
      // 0 = GuildText, 5 = GuildAnnouncement
      await interaction.editReply({ content: 'Please select a text channel.', embeds: [] });
      return;
    }

    await pool.query(
      `
        UPDATE ${extra[0]} SET ${action} = $1 WHERE guild_id = $2
        `,
      [selectedChannel?.id, guildId]
    );
    const { embed, components } = await buildFeatureEmbedAndComponents(guildId, interaction.user.id, 'tickets');
    await message.edit({ embeds: [embed], components });
    await interaction.editReply({ content: '✅ Updated successfully', embeds: [] });
  },
};

export default sendLogsIdentifier;
