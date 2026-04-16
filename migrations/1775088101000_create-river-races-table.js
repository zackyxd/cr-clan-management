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
  pgm.createTable('river_races', {
    race_id: 'id',
    guild_id: { type: 'varchar(20)', notNull: true },
    clan_name: { type: 'varchar(30)', notNull: true },
    clantag: { type: 'varchar(20)', notNull: true },
    race_state: { type: 'varchar(20)' }, // 'training', 'warDay', 'colosseum', etc.
    current_day: { type: 'integer', default: 0 }, // 0 = training, 1-4 = war days (periodIndex)
    current_week: { type: 'integer', notNull: true }, // week # (sectionIndex)
    season_id: { type: 'integer', default: null }, // season #
    end_time: { type: 'timestamptz', default: null },
    last_check: { type: 'timestamptz', default: null },
    current_data: { type: 'jsonb', default: null },
    opponent_clans: { type: 'jsonb', default: null },
    previous_decks_used_today: { type: 'integer', default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('river_races', 'guild_id');
  pgm.createIndex('river_races', 'clantag');
  pgm.createIndex('river_races', ['clantag', 'end_time']);

  // Unique constraint for clan + season + week (only when season_id is known)
  pgm.sql(`
    CREATE UNIQUE INDEX idx_river_races_unique_season 
    ON river_races(clantag, season_id, current_week) 
    WHERE season_id IS NOT NULL
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('river_races');
};
