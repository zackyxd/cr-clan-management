import { Client, Collection, GatewayIntentBits, Events, ActivityType } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Command } from './types/Command.ts';

// import { isDev, isProd } from './utils/env.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();
client.cooldowns = new Collection();

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
console.log('Command files:', commandFiles);

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

  await initialize_guilds_on_start(client.guilds.cache);
  await remove_guilds_on_start(client.guilds.cache);
});

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

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception: %O', err);
});
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection: %O', err);
});

import 'dotenv-flow/config';
import { initialize_guilds_on_start, remove_guilds_on_start } from './utils/sql_queries/sql_guilds.js';
import logger from './logger.js';

// import pool from './dbConfig.js';
logger.info(`🌱 Environment: ${process.env.NODE_ENV || 'development (default)'}`);
client.login(process.env.TOKEN);
