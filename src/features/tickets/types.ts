import type { Client, EmbedBuilder } from 'discord.js';

/**
 * Response structure for ticket operations
 */
export interface TicketResponse {
  success: boolean;
  error?: string;
  validTags?: string[];
  embeds?: EmbedBuilder[];
  invalidEmbeds?: EmbedBuilder[];
}

/**
 * Ticket data from database
 */
export interface TicketData {
  guildId: string;
  channelId: string;
  playertags: string[];
  createdBy: string;
  isClosed: boolean;
  createdAt?: Date;
  closedAt?: Date;
}

/**
 * Ticket settings from database
 */
export interface TicketSettings {
  guildId: string;
  openedIdentifier: string;
  closedIdentifier: string;
}

/**
 * Parameters for adding playertags to a ticket
 */
export interface AddPlayertagsParams {
  guildId: string;
  channelId: string;
  playertags: string[];
  userId: string;
}

/**
 * Parameters for updating ticket identifier
 */
export interface UpdateIdentifierParams {
  guildId: string;
  settingKey: 'opened_identifier' | 'closed_identifier';
  value: string;
}

/**
 * Parameters for closing a ticket
 */
export interface CloseTicketParams {
  guildId: string;
  channelId: string;
  client: Client;
}

/**
 * Ticket feature validation result
 */
export interface TicketFeatureCheck {
  enabled: boolean;
  settings?: TicketSettings;
  ticketData?: TicketData;
}
