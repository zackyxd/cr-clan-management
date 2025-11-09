import { ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel } from 'discord.js';
import { pool } from '../../../db.js';
import logger from '../../../logger.js';
import { makeCustomId } from '../../../utils/customId.js';

export async function handleTicketCreate(textChannel: TextChannel, guildId: string): Promise<boolean> {
  // gf = guild_feature table, ts = ticket_settings table
  const ticketRes = await pool.query(
    `
    SELECT gf.is_enabled, ts.opened_identifier
    FROM guild_features gf
    JOIN ticket_settings ts
      ON ts.guild_id = gf.guild_id
    WHERE gf.guild_id = $1 
      AND gf.feature_name = $2
      AND gf.is_enabled = TRUE
    `,
    [guildId, 'tickets']
  );
  if (ticketRes.rows.length === 0) {
    logger.info(`Guild ${guildId} had a channel ${textChannel.id} created, but the feature was not enabled.`);
    return false;
  }

  const ticketData = ticketRes.rows[0];
  if (textChannel.name.includes(ticketData.opened_identifier)) {
    const button = new ButtonBuilder()
      .setLabel(`Enter Clash Royale Playertags`)
      .setCustomId(makeCustomId('b', 'open_modal', guildId, { cooldown: 1, extra: ['ticket_channel'] }))
      .setStyle(ButtonStyle.Primary);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    setTimeout(async () => {
      await textChannel.send({ components: [row] });
    }, 1500);

    return true;
  }
  return true;
}
