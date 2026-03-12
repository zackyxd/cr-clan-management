/**
 * Clan settings table - DEPRECATED
 * All settings are now stored as individual columns in the clans table for better performance.
 * This migration is kept as a no-op to maintain migration history.
 * 
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // No-op: clan_settings table is not needed
  // All settings are stored in the clans table as individual columns
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // No-op: Nothing to undo
};
