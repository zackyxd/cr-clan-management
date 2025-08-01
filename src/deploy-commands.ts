import { REST, Routes } from 'discord.js';
import 'dotenv/config'; // Or:
import dotenv from 'dotenv';
dotenv.config({ path: `.env.${process.env.NODE_ENV}` }); // 👈 loads .env.dev

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const commands = [];
// Grab all the command folders from the commands directory you created earlier
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
  // Grab all the command files from the commands directory you created earlier
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.ts') || file.endsWith('.js'));

  // Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const commandModule = await import(filePath);
    const command = commandModule.default || commandModule;
    if ('data' in command && 'execute' in command) {
      commands.push(command.data.toJSON());
    } else {
      console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
  }
}

// Construct and prepare an instance of the REST module
if (!process.env.TOKEN) {
  throw new Error('TOKEN environment variable is missing.');
}
const rest = new REST().setToken(process.env.TOKEN as string);

// and deploy your commands!
(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    // The put method is used to fully refresh all commands in the guild with the current set
    if (!process.env.CLIENT_ID || !process.env.GUILD_ID) {
      throw new Error('CLIENT_ID or GUILD_ID environment variable is missing.');
    }
    // const data = await rest.put(
    //   Routes.applicationGuildCommands(process.env.CLIENT_ID as string, process.env.GUILD_ID as string),
    //   { body: commands }
    // );
    const data = await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });

    if (Array.isArray(data)) {
      console.log(`Successfully reloaded ${data.length} application (/) commands.`);
    } else {
      console.log(`Successfully reloaded application (/) commands.`);
    }
  } catch (error) {
    console.error(error);
  }
})();
