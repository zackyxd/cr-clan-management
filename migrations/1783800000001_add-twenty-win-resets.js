/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addColumns('twenty_win_challenge_players', {
    // Losses in the current run (a run ends at 3)
    current_losses: { type: 'integer', notNull: true, default: 0 },
    // How many times the player started a new run
    resets: { type: 'integer', notNull: true, default: 0 },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumns('twenty_win_challenge_players', ['current_losses', 'resets']);
};
