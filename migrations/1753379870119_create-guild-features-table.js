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

  pgm.createTable('guild_features', {
    guild_id: { type: 'varchar(30)', onDelete: 'CASCADE' },
    feature_name: { type: 'varchar(50)' },
    is_enabled: { type: 'boolean', default: false }
  },
    {
      constraints: {
        primaryKey: ['guild_id', 'feature_name']
      }
    });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('guild_features');
};
