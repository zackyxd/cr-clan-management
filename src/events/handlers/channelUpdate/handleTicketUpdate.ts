import { TextChannel } from 'discord.js';
import pool from '../../../db.js';
import logger from '../../../logger.js';

export async function handleTicketUpdate(
  oldChannel: TextChannel,
  newChannel: TextChannel,
  guildId: string
): Promise<boolean> {
  const ticketChannelId = newChannel.id;

  const validTicketRes = await pool.query(
    `
    SELECT gf.is_enabled, ts.closed_identifier, t.channel_id, t.playertags, t.is_closed
    FROM guild_features gf
    JOIN ticket_settings ts
      ON ts.guild_id = gf.guild_id
    JOIN tickets t
      ON t.guild_id = gf.guild_id AND t.channel_id = $2
    WHERE gf.guild_id = $1
      AND gf.feature_name = 'tickets'
      AND gf.is_enabled = TRUE
    `,
    [guildId, ticketChannelId]
  );
  if (validTicketRes.rows.length === 0) {
    return false;
  }
  // Now you know the feature is enabled and the channel exists in tickets table
  const ticketData = validTicketRes.rows[0];

  if (oldChannel.name !== newChannel.name && newChannel.name.includes(ticketData.closed_identifier)) {
    logger.info(
      `Ticket channel name changed from "${oldChannel.name}" to "${newChannel.name}". Identifier '${ticketData.closed_identifier}' found!`
    );

    if (!ticketData.is_closed) {
      try {
        await pool.query(
          `
          UPDATE tickets
          SET is_closed = TRUE,
            closed_at = NOW()
          WHERE guild_id = $1 AND channel_id = $2
          `,
          [guildId, ticketChannelId]
        );

        const channel = await newChannel.guild.channels.fetch(ticketChannelId);
        if (channel?.isTextBased()) {
          // TODO
          await channel.send(
            'Ticket is closed...show info about auto-link. Tags to link are: ' + ticketData.playertags
          );
        }
      } catch (error) {
        logger.error(`Failed to update ticket status or send message: %O`, error);
      }
    }
    return true;
  }
  return false;
}
