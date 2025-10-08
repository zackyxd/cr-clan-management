import { TextChannel } from 'discord.js';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import { linkUser } from '../../../services/users.js';

export async function handleTicketUpdate(
  oldChannel: TextChannel,
  newChannel: TextChannel,
  guildId: string
): Promise<boolean> {
  const ticketChannelId = newChannel.id;

  const validTicketRes = await pool.query(
    `
    SELECT gf.is_enabled, ts.closed_identifier, t.created_by, t.channel_id, t.playertags, t.is_closed
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
          // await channel.send(
          //   'Ticket is closed...show info about auto-link. Tags to link are: ' + ticketData.playertags
          // );

          let avatarUrl: string | undefined;
          let user;
          try {
            user = await newChannel.guild.members.fetch(ticketData.created_by);
            avatarUrl = user.displayAvatarURL();
          } catch {
            // Member not in guild, try fetching as a global user
            try {
              user = await newChannel.client.users.fetch(ticketData.created_by);
              avatarUrl = user.displayAvatarURL();
            } catch {
              // User not found, use a default avatar or leave undefined
              avatarUrl = undefined;
            }
          }
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            for (let i = 0; i < ticketData.playertags.length; i++) {
              const playertag = ticketData.playertags[i];

              const { embed, components } = await linkUser(client, guildId, ticketData.created_by, playertag);
              if (components && components.length > 0) {
                // Convert builder instances to raw JSON data for Discord API
                const rawComponents = components.map((c) => c.toJSON());
                await channel.send({ embeds: [embed], components: rawComponents }); // If need to relink
              } else {
                const oldFooter = embed.data.footer?.text ?? '';
                if (oldFooter.length > 1) {
                  embed.setFooter({ text: oldFooter, iconURL: avatarUrl });
                }
                await channel.send({ embeds: [embed] });
              }
            }
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            console.log(`error from handleTickeTUpdate.ts`, error);
          } finally {
            client.release();
          }
        }
      } catch (error) {
        logger.error(`Failed to update ticket status or send message: %O`, error);
      }
    }
    return true;
  } else if (oldChannel.name !== newChannel.name && !newChannel.name.includes(ticketData.closed_identifier)) {
    if (ticketData.is_closed) {
      try {
        await pool.query(
          `
          UPDATE tickets
          SET is_closed = FALSE,
            closed_at = NOW()
          WHERE guild_id = $1 AND channel_id = $2
          `,
          [guildId, ticketChannelId]
        );
      } catch (error) {
        logger.error(`Failed to update ticket status to opened: %O`, error);
      }
    }
  }
  return false;
}
