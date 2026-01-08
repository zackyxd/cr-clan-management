import { ChannelType, Events, GuildChannel, TextChannel } from 'discord.js';
import { handleTicketChannelCreate } from '../features/tickets/events/channelCreate.js';
import logger from '../logger.js';

export const event = {
  name: Events.ChannelCreate,
  async execute(channel: GuildChannel) {
    if (channel.type !== ChannelType.GuildText) return;
    const textChannel = channel as TextChannel;

    const handlers = [(ch: TextChannel, gid: string) => handleTicketChannelCreate(ch, gid)];

    for (const handler of handlers) {
      try {
        const handled = await handler(textChannel, textChannel.guild.id);
        if (handled) break; // Stop once one handler claims it
      } catch (err) {
        logger.error(`Error in channel create handler: %O`, err);
      }
    }
  },
};
