import { ChannelType, Events, GuildChannel, TextChannel } from 'discord.js';
import { handleTicketCreate } from './handlers/channelCreate/handleTicketCreate.js';
import logger from '../logger.js';
export const event = {
  name: Events.ChannelCreate,
  async execute(channel: GuildChannel) {
    if (channel.type !== ChannelType.GuildText) return;
    const textChannel = channel as TextChannel;

    const handlers = [handleTicketCreate];

    for (const handler of handlers) {
      try {
        const handled = await handler(textChannel, textChannel.guild.id); // return true if it handled
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

// function checkChannelName(channelData: ): boolean {

// }
