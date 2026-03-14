// Load environment variables first
import 'dotenv-flow/config';

import { Client, Collection, GatewayIntentBits, Events, ActivityType } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Command } from './types/Command.ts';
import { insert_guilds_on_startup, remove_guilds_on_startup, sync_default_features } from './services/guilds.js';
import logger from './logger.js';
import { pool } from './db.js';
import { loadButtons } from './interactions/handleButtonInteraction.js';
import { loadModals } from './interactions/handleModalInteraction.js';
import { loadSelectMenus } from './interactions/handleSelectMenuInteraction.js';
import { InviteScheduler } from './features/clan-invites/scheduler.js';
import { validateEnvironment } from './utils/env.js';
import { HealthCheckServer } from './utils/healthCheck.js';

// Validate environment variables before starting
validateEnvironment();
logger.info(`🌱 Environment: ${process.env.NODE_ENV || 'development (default)'}`);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();
client.cooldowns = new Collection();

// Initialize health check server
const healthCheckServer = new HealthCheckServer(client, 3000);

// Get __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Recursively find all .ts/.js files in commands directory
function getCommandFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getCommandFiles(fullPath));
    } else if (entry.isFile() && ['.ts', '.js'].includes(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

// Load command modules
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = getCommandFiles(commandsPath);

for (const file of commandFiles) {
  const fileUrl = pathToFileURL(file).href;
  const command: Command = (await import(fileUrl)).default;
  if (command && command.data && typeof command.execute === 'function') {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`Skipping invalid command file: ${file}`);
  }
}

client.once(Events.ClientReady, async (c) => {
  logger.info(`✅ Ready! Logged in as ${c.user.tag}`);
  c.user.setActivity({
    name: 'over clans',
    type: ActivityType.Watching,
  });
  await loadButtons();
  await loadModals();
  await loadSelectMenus();
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    await insert_guilds_on_startup(dbClient, client.guilds.cache);
    await remove_guilds_on_startup(dbClient, client.guilds.cache);
    await sync_default_features(dbClient);
    await dbClient.query('COMMIT');
  } catch (error) {
    await dbClient.query('ROLLBACK');
    logger.error('Failed during guild sync on startup:', error);
  } finally {
    dbClient.release();
  }

  // Start clan invite scheduler
  const inviteScheduler = new InviteScheduler(c);
  inviteScheduler.start();
  
  // Start health check server
  healthCheckServer.start();
  
  logger.info('🚀 Bot fully initialized and ready');
});

// NOTE: Old interaction handling moved to events/interactionCreate.ts with new feature-based dispatcher

// Register events
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith('.ts') || file.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  const { event } = await import(filePath); // dynamic import must match your export

  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

// Global error handlers to prevent crashes
process.on('unhandledRejection', (error: Error) => {
  logger.error('Unhandled Rejection:', error);
  // Don't exit the process for unhandled rejections in production
  if (process.env.NODE_ENV === 'dev' || process.env.NODE_ENV === 'development') {
    logger.error('Stack trace:', error.stack);
  }
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error);
  logger.error('Stack trace:', error.stack);
  // For uncaught exceptions, we must exit as the process state is unknown
  logger.error('Process will exit due to uncaught exception');
  process.exit(1);
});

// Graceful shutdown handlers
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    logger.warn(`Already shutting down, ignoring ${signal}`);
    return;
  }
  
  isShuttingDown = true;
  logger.info(`${signal} received, starting graceful shutdown...`);
  
  try {
    // Stop health check server first
    logger.info('Stopping health check server...');
    await healthCheckServer.stop();
    
    // Set bot status to indicate shutdown
    if (client.user) {
      await client.user.setStatus('invisible');
      logger.info('Bot status set to invisible');
    }
    
    // Close database connection pool
    logger.info('Closing database connections...');
    await pool.end();
    logger.info('Database connections closed');
    
    // Destroy Discord client
    logger.info('Destroying Discord client...');
    client.destroy();
    logger.info('Discord client destroyed');
    
    logger.info('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the bot
client.login(process.env.TOKEN);
