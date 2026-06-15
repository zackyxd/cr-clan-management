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

// League trophy thresholds (derived from clan_trophies on the clans table)
export const LEAGUE_5K_MIN = 5000;
export const LEAGUE_4K_MIN = 4000;

/** Returns the league key ('5k', '4k') for a given clan trophy count, or null if unrecognised. */
export function getLeagueFromTrophies(trophies: number): '5k' | '4k' | null {
  if (trophies >= LEAGUE_5K_MIN) return '5k';
  if (trophies >= LEAGUE_4K_MIN) return '4k';
  return null;
}

// How many completed war weeks to look back when building the Available sheet
export const AVAILABLE_SHEET_WEEKS_LOOKBACK = 6;

// Google accounts (besides the bot's service account) that can edit or remove
// the protected ranges the bot adds to stats sheets (Lineups, Kicks, Available,
// L2W/Inactive). Add an email here if someone needs to be able to unprotect a
// cell from the Sheets UI in case the bot ever gets stuck.
export const PROTECTED_RANGE_ADMIN_EMAILS: string[] = ['shitrandom67@gmail.com'];
