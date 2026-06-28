export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('river_races', {
    race_id: 'id',
    clan_name: { type: 'varchar(30)', notNull: true },
    clantag: { type: 'varchar(20)', notNull: true },
    race_state: { type: 'varchar(20)' },
    current_day: { type: 'integer', default: 0 },
    current_week: { type: 'integer', notNull: true },
    season_id: { type: 'integer', default: null },
    end_time: { type: 'timestamptz', default: null },
    last_check: { type: 'timestamptz', default: null },
    current_data: { type: 'jsonb', default: null },
    opponent_clans: { type: 'jsonb', default: null },
    previous_decks_used_today: { type: 'integer', default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('river_races', 'clantag');
  pgm.createIndex('river_races', ['clantag', 'end_time']);
  pgm.sql(`
    CREATE UNIQUE INDEX idx_river_races_unique_season
    ON river_races(clantag, season_id, current_week)
    WHERE season_id IS NOT NULL
  `);

  pgm.createTable(
    'race_participant_tracking',
    {
      tracking_id: 'id',
      race_id: { type: 'integer', notNull: true, references: 'river_races(race_id)', onDelete: 'CASCADE' },
      playertag: { type: 'varchar(20)', notNull: true },
      player_name: { type: 'varchar(50)', notNull: true },
      clantag: { type: 'varchar(20)', notNull: true },
      clan_name: { type: 'varchar(50)' },
      current_day: { type: 'integer', notNull: true, default: 0 },
      fame: { type: 'integer', default: 0 },
      decks_used: { type: 'integer', default: 0 },
      decks_used_today: { type: 'integer', default: 0 },
      clans_attacked_in: { type: 'text[]', default: pgm.func("'{}'::text[]") },
      clan_names_attacked_in: { type: 'text[]', default: pgm.func("'{}'::text[]") },
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
  pgm.createIndex('race_participant_tracking', ['race_id', 'current_day']);

  pgm.createTable(
    'race_day_snapshots',
    {
      snapshot_id: 'id',
      race_id: { type: 'integer', notNull: true, references: 'river_races(race_id)', onDelete: 'CASCADE' },
      guild_id: { type: 'varchar(30)', notNull: true },
      race_day: { type: 'integer', notNull: true },
      snapshot_time: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      snapshot_data: { type: 'jsonb', notNull: true },
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

  pgm.createTable('race_nudges', {
    nudge_id: 'id',
    race_id: { type: 'integer', notNull: true, references: 'river_races(race_id)', onDelete: 'CASCADE' },
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

export const down = (pgm) => {
  pgm.dropTable('race_nudges');
  pgm.dropTable('race_day_snapshots');
  pgm.dropTable('race_participant_tracking');
  pgm.dropTable('river_races');
};
