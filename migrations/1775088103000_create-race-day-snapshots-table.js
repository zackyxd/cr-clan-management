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
  pgm.createTable(
    'race_day_snapshots',
    {
      snapshot_id: 'id',
      race_id: {
        type: 'integer',
        notNull: true,
        references: 'river_races(race_id)',
        onDelete: 'CASCADE',
      },
      race_day: { type: 'integer', notNull: true },
      snapshot_time: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      snapshot_data: { type: 'jsonb', notNull: true },
    },
    {
      constraints: {
        unique: ['race_id', 'race_day'],
      },
    },
  );

  pgm.createIndex('race_day_snapshots', 'race_id');
  pgm.createIndex('race_day_snapshots', ['race_id', 'race_day']);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('race_day_snapshots');
};
