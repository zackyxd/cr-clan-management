// inviteWorker.ts - Simple implementation that processes invite queue jobs
import { Worker } from 'bullmq';
import { pool } from '../../db.js';
import { Client, DMChannel, GatewayIntentBits, NewsChannel, TextChannel } from 'discord.js';
import 'dotenv-flow/config';
import { repostInviteMessage, updateInviteMessage } from '../../commands/staff_commands/updateClanInvite.js';
import logger from '../../logger.js';
import { inviteQueue } from '../../queues/queueManager.js';

// Create Discord client
const discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

// Track worker health
let lastSuccessfulJob = Date.now();
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Health check - if we haven't processed a job in too long, restart
setInterval(() => {
  const timeSinceLastJob = Date.now() - lastSuccessfulJob;
  if (timeSinceLastJob > 15 * 60 * 1000) {
    // 15 minutes
    logger.error(
      `Invite Worker unhealthy: No successful jobs in ${Math.round(
        timeSinceLastJob / 1000 / 60
      )} minutes. Exiting for restart.`
    );
    process.exit(1); // Exit with error code so process manager restarts us
  }
}, HEALTH_CHECK_INTERVAL);

// Handle unexpected errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in invite worker:', error);
  // Allow a bit of time for logging to complete
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection in invite worker:', reason);
  // Allow a bit of time for logging to complete
  setTimeout(() => process.exit(1), 1000);
});

// Normal worker startup
discordClient.once('ready', () => {
  logger.info('Invite worker Discord client ready, starting queue worker');

  const worker = new Worker(
    'inviteQueue',
    async (job) => {
      try {
        logger.info(`Processing invite job: ${job.name} with ID: ${job.id}`);

        // Handle only expireInvite jobs (ignore any other job types)
        if (job.name !== 'expireInvite') {
          logger.info(`Ignoring job with name: ${job.name}`);
          return { status: 'ignored', reason: 'unknown_job_type' };
        }

        // Handle individual invite expiration jobs
        const { guildId, clantag } = job.data as { guildId: string; clantag: string };
        logger.info(`Extracted from job.data - guildId: "${guildId}", clantag: "${clantag}"`);

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

        if (!rows.length) return { status: 'no_data' };

        const { active_clan_link_expiry_time, channel_id, message_id, pin_message } = rows[0];
        if (new Date(active_clan_link_expiry_time) > new Date()) {
          return { status: 'not_expired' };
        }

        // Update Discord message
        const channel = await discordClient.channels.fetch(channel_id);
        if (!channel || !channel.isTextBased()) {
          logger.error('Could not find text channel for inviteQueue worker');
          return { status: 'channel_not_found' };
        }

        const { embeds, components } = await updateInviteMessage(pool, guildId);
        await repostInviteMessage({
          client: discordClient,
          channelId: channel_id,
          messageId: message_id,
          embeds,
          components,
          pin: pin_message,
          pool: pool,
          guildId: guildId,
        });

        if (rows[0].role_id && rows[0].ping_expired === true) {
          if (channel instanceof TextChannel || channel instanceof NewsChannel || channel instanceof DMChannel) {
            // Send notification and delete after a short time
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

        // Update database
        await pool.query(
          `
          UPDATE clans
          SET active_clan_link = $1, active_clan_link_expiry_time = $2
          WHERE guild_id = $3 AND clantag = $4
          `,
          [null, null, guildId, clantag]
        );

        logger.info(`Updated message and db for ${clantag}`);
        lastSuccessfulJob = Date.now();

        return { status: 'success' };
      } catch (error) {
        logger.error('Error processing invite queue job:', error);
        throw error;
      }
    },
    {
      connection: inviteQueue.opts.connection,
    }
  );

  worker.on('completed', (job) => {
    logger.info(`Invite job ${job.id} completed`);
    lastSuccessfulJob = Date.now();
  });

  worker.on('failed', (job, err) => {
    logger.error(`Invite job ${job?.id} failed:`, err);
  });

  logger.info('Invite worker started and listening for jobs');
});

// Start Discord client
discordClient.login(process.env.TOKEN).catch((err) => {
  logger.error('Discord client login failed:', err);
  process.exit(1);
});
