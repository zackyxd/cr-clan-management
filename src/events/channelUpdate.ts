import { ChannelType, Events, GuildChannel, TextChannel } from 'discord.js';
import { isDev } from '../utils/env.js';
import { handleTicketUpdate } from './handlers/channelUpdate/handleTicketUpdate.js';
import logger from '../logger.js';
console.log(isDev);
export const event = {
  name: Events.ChannelUpdate,
  async execute(oldChannel: GuildChannel, newChannel: GuildChannel) {
    if (newChannel.type !== ChannelType.GuildText) return;
    const textChannel = newChannel as TextChannel;

    const handlers = [handleTicketUpdate];

    for (const handler of handlers) {
      try {
        const handled = await handler(oldChannel as TextChannel, newChannel as TextChannel, textChannel.guild.id); // return true if it handled
        if (handled) break; // Stop once one handler claims it
      } catch (err) {
        logger.error(`Error in ${handler.name} %O`, err);
      }
    }

    // if (isDev) {
    //   await textChannel.delete();
    //   console.log('A text channel was deleted');
    // }
  },
};
