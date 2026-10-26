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
  // Per-player polling state for the 20 Win Challenge tracker.
  // last_battle_time = newest challenge battle already processed (so it is never posted twice)
  // next_check_at = earliest time the battle log should be fetched again (API call backoff)
  pgm.createTable('twenty_win_challenge_players', {
    playertag: { type: 'varchar(20)', primaryKey: true },
    current_wins: { type: 'integer', notNull: true, default: 0 },
    last_battle_time: { type: 'timestamptz', default: null },
    next_check_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('twenty_win_challenge_players', 'next_check_at');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('twenty_win_challenge_players');
};
