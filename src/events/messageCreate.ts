import { Events, Message } from 'discord.js';
import logger from '../logger.js';
import { getGuildMessageContext, GuildMessageContext } from '../cache/guildMessageContextCache.js';
import { handleClanInvitePosted, handleClanInviteSend } from '../features/clan-invites/events/messageCreate.js';
import { handleRaceRoleMention } from '../features/race-tracking/events/messageCreate.js';

export const event = {
  name: Events.MessageCreate,
  async execute(message: Message) {
    if (!message.guild || message.author.bot) return;

    // One (cached) DB round-trip per guild, shared across every handler below.
    const context = await getGuildMessageContext(message.guild.id);

    const handlers: ((msg: Message, ctx: GuildMessageContext) => Promise<boolean>)[] = [
      (msg, ctx) => handleClanInvitePosted(msg, ctx),
      (msg, ctx) => handleClanInviteSend(msg, ctx),
      (msg, ctx) => handleRaceRoleMention(msg, ctx),
      // Add more feature handlers here, e.g.:
      // (msg, ctx) => handleSomeFeatureMessageCreate(msg, ctx),
    ];

    for (const handler of handlers) {
      try {
        const handled = await handler(message, context);
        if (handled) break; // Stop once one handler claims it
      } catch (err) {
        logger.error(`Error in message create handler: %O`, err);
      }
    }
  },
};
