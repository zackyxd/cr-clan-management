import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.TOKEN) {
  throw new Error('TOKEN environment variable is missing.');
}
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

if (!process.env.CLIENT_ID) {
  throw new Error('TOKEN environment variable is missing.');
}
if (!process.env.GUILD_ID) {
  throw new Error('TOKEN environment variable is missing.');
}

rest
  .put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [] })
  .then(() => console.log('Successfully deleted all guild commands.'))
  .catch(console.error);

// for global commands
rest
  .put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] })
  .then(() => console.log('Successfully deleted all application commands.'))
  .catch(console.error);
