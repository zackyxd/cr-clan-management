import { TextChannel, Client } from 'discord.js';
import { ticketService } from '../service.js';
import logger from '../../../logger.js';

export async function handleTicketChannelDelete(
  channel: TextChannel,
  guildId: string,
  client: Client,
): Promise<boolean> {
  try {
    const featureCheck = await ticketService.isFeatureEnabled(guildId);
    if (!featureCheck.enabled || !featureCheck.settings) {
      return false;
    }

    const ticketData = await ticketService.getTicketData(guildId, channel.id);
    if (!ticketData) {
      return false;
    }

    if (ticketData.isClosed) {
      return false;
    }

    logger.info(`Ticket channel "${channel.name}" was deleted. Closing ticket and auto-linking.`);

    const result = await ticketService.closeTicketOnDeletion({
      guildId,
      channelId: channel.id,
      client,
      channelName: channel.name,
    });

    if (!result.success) {
      logger.error(`Failed to close ticket on channel deletion: ${result.error}`);
      return false;
    }

    return true;
  } catch (error) {
    logger.error(`Error handling ticket channel delete:`, error);
    return false;
  }
}
