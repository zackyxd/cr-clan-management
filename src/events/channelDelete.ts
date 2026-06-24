import { ChannelType, Events, GuildChannel, TextChannel } from 'discord.js';
import { handleTicketChannelDelete } from '../features/tickets/events/channelDelete.js';
import logger from '../logger.js';

export const event = {
  name: Events.ChannelDelete,
  async execute(channel: GuildChannel) {
    if (channel.type !== ChannelType.GuildText) return;
    const textChannel = channel as TextChannel;

    const handlers = [
      (ch: TextChannel, gid: string) => handleTicketChannelDelete(ch, gid, channel.client),
    ];

    for (const handler of handlers) {
      try {
        const handled = await handler(textChannel, textChannel.guild.id);
        if (handled) break;
      } catch (err) {
        logger.error(`Error in channel delete handler: %O`, err);
      }
    }
  },
};
