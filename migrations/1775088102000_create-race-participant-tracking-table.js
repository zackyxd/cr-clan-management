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
    'race_participant_tracking',
    {
      tracking_id: 'id',
      race_id: {
        type: 'integer',
        notNull: true,
        references: 'river_races(race_id)',
        onDelete: 'CASCADE',
      },
      playertag: { type: 'varchar(20)', notNull: true },
      player_name: { type: 'varchar(50)', notNull: true },
      clantag: { type: 'varchar(20)', notNull: true },
      fame: { type: 'integer', default: 0 },
      decks_used: { type: 'integer', default: 0 },
      decks_used_today: { type: 'integer', default: 0 },
      clans_attacked_in: { type: 'text[]', default: pgm.func("'{}'::text[]") },
      last_updated: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    },
    {
      constraints: {
        unique: ['race_id', 'playertag', 'clantag'],
      },
    },
  );

  pgm.createIndex('race_participant_tracking', 'race_id');
  pgm.createIndex('race_participant_tracking', 'playertag');
  pgm.createIndex('race_participant_tracking', ['race_id', 'decks_used_today']);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('race_participant_tracking');
};
