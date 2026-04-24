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
      guild_id: { type: 'varchar(30)', notNull: true }, // Guild-specific snapshots for guild-specific data (links, settings)
      race_day: { type: 'integer', notNull: true },
      snapshot_time: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      snapshot_data: { type: 'jsonb', notNull: true }, // Contains: rawApiData (CurrentRiverRace) + embedData (pre-computed attacks/race display with guild-specific links/settings)
    },
    {
      constraints: {
        unique: ['race_id', 'guild_id', 'race_day'],
      },
    },
  );

  pgm.createIndex('race_day_snapshots', 'race_id');
  pgm.createIndex('race_day_snapshots', 'guild_id');
  pgm.createIndex('race_day_snapshots', ['race_id', 'guild_id', 'race_day']);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('race_day_snapshots');
};
