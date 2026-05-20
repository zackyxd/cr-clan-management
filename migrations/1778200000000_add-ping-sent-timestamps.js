/**
 * Add boolean columns to track if ping messages were sent today
 * This prevents spam by allowing only one message per day
 * These flags will be reset at a specific time daily via scheduler
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
  pgm.addColumns('users', {
    replace_me_ping_sent_today: {
      type: 'boolean',
      default: false,
    },
    attacking_late_ping_sent_today: {
      type: 'boolean',
      default: false,
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumns('users', ['replace_me_ping_sent_today', 'attacking_late_ping_sent_today']);
};
