import { Events, TextChannel } from 'discord.js';
import { isDev } from '../utils/env.js';

export const event = {
  name: Events.ChannelCreate,
  async execute(textChannel: TextChannel) {
    console.log(textChannel);
    console.log('A text channel was created');
    await textChannel.delete();
    if (isDev) {
      console.log('A text channel was deleted');
    }
  },
};

// function checkChannelName(channelData: ): boolean {

// }
