import { ChannelType, Events, GuildChannel, TextChannel } from 'discord.js';
import { handleTicketChannelUpdate } from '../features/tickets/events/channelUpdate.js';
import logger from '../logger.js';

export const event = {
  name: Events.ChannelUpdate,
  async execute(oldChannel: GuildChannel, newChannel: GuildChannel) {
    if (newChannel.type !== ChannelType.GuildText) return;
    const textChannel = newChannel as TextChannel;

    const handlers = [
      (oldCh: TextChannel, newCh: TextChannel, gid: string) =>
        handleTicketChannelUpdate(oldCh, newCh, gid, newChannel.client),
    ];

    for (const handler of handlers) {
      try {
        const handled = await handler(oldChannel as TextChannel, newChannel as TextChannel, textChannel.guild.id);
        if (handled) break; // Stop once one handler claims it
      } catch (err) {
        logger.error(`Error in channel update handler: %O`, err);
      }
    }
  },
};
