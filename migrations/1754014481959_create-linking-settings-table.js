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

  pgm.createTable('linking_settings', {
    guild_id: { type: 'varchar(30)', references: 'guilds(guild_id)', onDelete: 'CASCADE', primaryKey: true },
    rename_players: { type: 'boolean', default: false },
    max_links: { type: 'integer', default: 10 }
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('linking_settings');
};
