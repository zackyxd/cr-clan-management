import { TextChannel } from 'discord.js';
// import logger from "../../../logger.js";

export async function handleTicketCreate(textChannel: TextChannel): Promise<boolean> {
  console.log(textChannel.id);
  return true;
}
