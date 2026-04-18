/**
 * Global constants for the application
 * Single source of truth for magic numbers and configuration values
 */

// Guild/Server limits
export const MAX_CLANS_PER_GUILD = 15;
export const MAX_FAMILY_CLANS_PER_GUILD = 10;
export const MAX_PLAYER_LINKS_PER_USER = 10;

// Ticket settings
export const DEFAULT_TICKET_OPENED_IDENTIFIER = 'ticket';
export const DEFAULT_TICKET_CLOSED_IDENTIFIER = 'closed';

// Session timeouts
export const SESSION_EXPIRY_MINUTES = 30;
export const SESSION_CLEANUP_INTERVAL_MINUTES = 5;

// Clan invite settings
export const DEFAULT_DELETE_METHOD = 'update';

// Race nudge settings
export const DEFAULT_NUDGE_MESSAGE = `You have attacks left in {clanName}!`;

// Add more constants as needed
