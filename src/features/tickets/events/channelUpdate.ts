import { TextChannel, Client } from 'discord.js';
import { ticketService } from '../service.js';
import logger from '../../../logger.js';

/**
 * Handle ticket channel updates
 * Detects when a ticket is closed (name change to include closed_identifier)
 * and auto-links all playertags
 */
export async function handleTicketChannelUpdate(
  oldChannel: TextChannel,
  newChannel: TextChannel,
  guildId: string,
  client: Client,
): Promise<boolean> {
  try {
    // Check if channel name changed
    if (oldChannel.name === newChannel.name) {
      return false;
    }

    // Check if feature is enabled and get ticket data
    const featureCheck = await ticketService.isFeatureEnabled(guildId);
    if (!featureCheck.enabled || !featureCheck.settings) {
      return false;
    }

    // Get ticket data for this channel
    const ticketData = await ticketService.getTicketData(guildId, newChannel.id);
    if (!ticketData) {
      return false;
    }

    const { closedIdentifier } = featureCheck.settings;
    const isNowClosed = ticketService.isTicketChannel(newChannel.name, closedIdentifier);
    const wasClosedBefore = ticketData.isClosed;

    // Ticket is being closed
    if (isNowClosed && !wasClosedBefore) {
      logger.info(
        `Ticket channel name changed from "${oldChannel.name}" to "${newChannel.name}". Closing ticket and auto-linking.`,
      );

      const result = await ticketService.closeTicket({
        guildId,
        channelId: newChannel.id,
        client,
      });

      if (!result.success) {
        logger.error(`Failed to close ticket: ${result.error}`);
        return false;
      }

      logger.info(`Successfully closed ticket and auto-linked ${result.embeds?.length || 0} accounts`);

      return true;
    }

    // Ticket is being reopened
    if (!isNowClosed && wasClosedBefore) {
      logger.info(`Ticket channel name changed from "${oldChannel.name}" to "${newChannel.name}". Reopening ticket.`);

      const result = await ticketService.reopenTicket(guildId, newChannel.id);

      if (!result.success) {
        logger.error(`Failed to reopen ticket: ${result.error}`);
        return false;
      }

      logger.info(`Successfully reopened ticket`);
      await ticketService.sendLog(
        client,
        guildId,
        'Ticket Reopened',
        `<@${ticketData.createdBy}> reopened a ticket <#${newChannel.id}>.`,
      );
      return true;
    }

    return false;
  } catch (error) {
    logger.error(`Error handling ticket channel update:`, error);
    return false;
  }
}
