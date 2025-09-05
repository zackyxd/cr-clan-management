import { EmbedBuilder } from 'discord.js';
import pool from '../../db.js';
import { ModalHandler } from '../../types/Handlers.js';
import { CR_API, FetchError } from '../../api/CR_API.js';
import { formatPlayerData } from '../../api/FORMAT_DATA.js';

// When modal with action ticket_channel is called, run this.
// Gets the playertags entered and shows the info
const ticketTicketChannel: ModalHandler = {
  customId: 'ticket_channel',
  async execute(interaction, parsed) {
    const { guildId } = parsed; // action will be "opened_identifier"
    await interaction.deferReply();
    const inputTags = interaction.fields.getTextInputValue('input').toUpperCase().split(' ');
    // Remove empty strings
    const normalizedTags = inputTags.map((tag) => CR_API.normalizeTag(tag)).filter(Boolean);
    const { rows } = await pool.query(`SELECT playertags FROM tickets WHERE guild_id = $1 AND channel_id = $2`, [
      guildId,
      interaction.channelId,
    ]);

    const currentTags: string[] = rows[0]?.playertags ?? [];
    const validTags: string[] = [];
    const embeds: EmbedBuilder[] = [];
    const invalidEmbeds: EmbedBuilder[] = [];

    for (let tag of normalizedTags) {
      if (currentTags.includes(tag)) continue; // skip duplicates
      tag = CR_API.normalizeTag(tag);

      const playerData = await CR_API.getPlayer(tag);

      if ('error' in playerData) {
        // playerData is a FetchError here
        const fetchError = playerData as FetchError;
        if (fetchError.embed) {
          invalidEmbeds.push(fetchError.embed);
        }
        continue;
      }

      // playerData is now narrowed to Player
      const embed = formatPlayerData(playerData);
      if (embed) embeds.push(embed);
      validTags.push(tag);
    }

    const uniqueValidTags = [...new Set(validTags)];

    if (embeds.length > 0) {
      await interaction.editReply({
        content: `**These are the entered playertags by <@${interaction.user.id}>**`,
        embeds: [...embeds, ...invalidEmbeds],
      });
    }

    await pool.query(
      `
        INSERT INTO tickets (guild_id, channel_id, playertags, created_by)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (guild_id, channel_id)
        DO UPDATE SET playertags = (
          SELECT ARRAY(
            SELECT DISTINCT unnest(t.playertags || EXCLUDED.playertags)
            ORDER BY 1
          )
          FROM tickets t
          WHERE t.guild_id = EXCLUDED.guild_id
            AND t.channel_id = EXCLUDED.channel_id
          )
        `,
      [guildId, interaction.channelId, uniqueValidTags, interaction.user.id]
    );
  },
};

export default ticketTicketChannel;
