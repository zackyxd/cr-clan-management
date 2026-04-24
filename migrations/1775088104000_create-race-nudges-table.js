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
  pgm.createTable('race_nudges', {
    nudge_id: 'id',
    race_id: {
      type: 'integer',
      notNull: true,
      references: 'river_races(race_id)',
      onDelete: 'CASCADE',
    },
    message_id: { type: 'varchar(30)', notNull: true },
    clantag: { type: 'varchar(20)', notNull: true },
    race_week: { type: 'integer', notNull: true },
    race_day: { type: 'integer', notNull: true },
    nudge_time: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    nudge_type: { type: 'varchar(50)', notNull: true, default: 'automatic' },
    message: { type: 'text', default: null },
    players_snapshot: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
  });

  pgm.createIndex('race_nudges', 'race_id');
  pgm.createIndex('race_nudges', ['race_id', 'race_day']);
  pgm.createIndex('race_nudges', ['race_id', 'clantag', 'race_day']);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('race_nudges');
};
