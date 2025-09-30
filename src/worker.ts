// worker.ts
import { Worker } from 'bullmq';
import { inviteQueue } from './queues/inviteQueue.js';
import pool from './db.js';
import { Client, DMChannel, GatewayIntentBits, NewsChannel, TextChannel } from 'discord.js';
const discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
import 'dotenv-flow/config';
import { repostInviteMessage, updateInviteMessage } from './commands/staff_commands/updateClanInvite.js';
import logger from './logger.js';

discordClient.once('ready', () => {
  console.log('Worker Discord client ready, starting queue worker');

  const worker = new Worker(
    'inviteQueue',
    async (job) => {
      const { guildId, clantag } = job.data;
      console.log('came in here?');
      // Check DB if link expired
      const { rows } = await pool.query(
        `
        SELECT 
          c.active_clan_link_expiry_time,
          cis.channel_id,
          cis.message_id,
          cis.ping_expired,
          cis.pin_message,
          cs.settings ->> 'clan_role_id' AS role_id
        FROM clans c
        JOIN clan_invite_settings cis
          ON c.guild_id = cis.guild_id
        JOIN clan_settings cs
          ON c.guild_id = cs.guild_id
          AND cs.clantag = c.clantag
        WHERE c.guild_id = $1 
          AND c.clantag = $2
        LIMIT 1`,
        [guildId, clantag]
      );
      console.log(rows);
      if (!rows.length) return;

      const { active_clan_link_expiry_time, channel_id, message_id, pin_message } = rows[0];
      if (new Date(active_clan_link_expiry_time) > new Date()) {
        console.log('here');
        return;
      }

      // Update Discord message
      const channel = await discordClient.channels.fetch(channel_id);
      if (!channel || !channel.isTextBased()) {
        console.log('Could not find text channel for inviteQueue worker');
        return;
      }

      const { embeds, components } = await updateInviteMessage(pool, guildId);
      await repostInviteMessage({
        client: discordClient,
        channelId: channel_id,
        messageId: message_id,
        embeds,
        components,
        pin: pin_message,
        pool: pool, // your PG client for transaction
        guildId: guildId,
      });

      if (rows[0].role_id && rows[0].ping_expired === true) {
        if (channel.isTextBased()) {
          if (channel instanceof TextChannel || channel instanceof NewsChannel || channel instanceof DMChannel) {
            // Now TypeScript knows `send()` exists
            const tempMessage = await channel.send(`<@&${rows[0].role_id}>, your link has expired.`);
            setTimeout(async () => {
              try {
                await tempMessage.delete();
              } catch (err) {
                logger.error('Failed to delete temporary message:', err);
              }
            }, 1000);
          }
        }
      }

      await pool.query(
        `
        UPDATE clans
        SET active_clan_link = $1, active_clan_link_expiry_time = $2
        WHERE guild_id = $3 AND clantag = $4
        `,
        [null, null, guildId, clantag]
      );

      console.log(`Updated message and db for ${clantag}`);
    },
    {
      connection: inviteQueue.opts.connection,
    }
  );

  worker.on('completed', (job) => console.log(`Job ${job.id} completed`));
  worker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err));
});

discordClient.login(process.env.TOKEN);
