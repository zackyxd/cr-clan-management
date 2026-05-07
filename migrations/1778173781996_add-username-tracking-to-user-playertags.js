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
  pgm.addColumns('user_playertags', {
    current_username: {
      type: 'varchar(30)',
      default: null,
    },
    previous_usernames: {
      type: 'text[]',
      default: pgm.func("'{}'::text[]"),
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumns('user_playertags', ['current_username', 'previous_usernames']);
};
