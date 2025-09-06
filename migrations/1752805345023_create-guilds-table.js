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
  pgm.createTable('guilds', {
    guild_id: { type: 'varchar(30)', primaryKey: true },
    max_clans: { type: 'integer', default: 15 },
    max_family_clans: { type: 'integer', default: 10 },
    max_player_links: { type: 'integer', default: 10 },
    joined_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    in_guild: { type: 'boolean', default: true },
    left_at: { type: 'timestamptz', default: null }
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('guilds');
};


// This migration has the initial guild setup. 
// Contains their guild_id, max_clans amount, and time joined

