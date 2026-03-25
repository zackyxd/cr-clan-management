import { ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel } from 'discord.js';
import { makeCustomId } from '../../../utils/customId.js';
import { ticketService } from '../service.js';
import logger from '../../../logger.js';

/**
 * Send the playertags entry button to a ticket channel
 */
export async function sendTicketButton(channel: TextChannel, guildId: string): Promise<void> {
  const button = new ButtonBuilder()
    .setLabel('Enter Clash Royale Playertags')
    .setCustomId(makeCustomId('b', 'ticketPlayertagsOpenModal', guildId, { cooldown: 10 }))
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  await channel.send({ components: [row] });
  logger.info(`Sent ticket button to channel ${channel.id} in guild ${guildId}`);
}

/**
 * Handle ticket creation when a channel is created
 * Sends a button to add playertags if the channel name matches the opened identifier
 */
export async function handleTicketChannelCreate(channel: TextChannel, guildId: string): Promise<boolean> {
  try {
    // Check if feature is enabled
    const featureCheck = await ticketService.isFeatureEnabled(guildId);
    if (!featureCheck.enabled || !featureCheck.settings) {
      logger.debug(`Tickets feature not enabled for guild ${guildId}`);
      return false;
    }

    // Check if channel name matches opened identifier
    if (!ticketService.isTicketChannel(channel.name, featureCheck.settings.openedIdentifier)) {
      return false;
    }

    // Delay to ensure channel is fully created
    setTimeout(async () => {
      await sendTicketButton(channel, guildId);
    }, 1500);

    return true;
  } catch (error) {
    logger.error(`Error handling ticket channel create:`, error);
    return false;
  }
}
