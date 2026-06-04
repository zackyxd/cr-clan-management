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
  pgm.addColumn('clans', {
    header_bg_hex: { type: 'VARCHAR(7)' },
    header_text_hex: { type: 'VARCHAR(7)' },
  });

  pgm.dropColumn('clans', 'color_index', { ifExists: true });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumn('clans', ['header_bg_hex', 'header_text_hex']);
};
