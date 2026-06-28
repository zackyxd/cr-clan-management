export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('player_availability', {
    guild_id: { type: 'varchar(30)', notNull: true, references: 'guilds(guild_id)', onDelete: 'CASCADE' },
    playertag: { type: 'varchar(20)', notNull: true },
    player_name: { type: 'varchar(50)', notNull: true },
    l2w_status: { type: 'varchar(10)', check: "l2w_status IN ('l2w', 'inactive', 'removed')" },
    l2w_notes: { type: 'text' },
    l2w_duration_date: { type: 'date' },
    l2w_marked_at: { type: 'timestamptz' },
    l2w_duration_days: { type: 'integer' },
    league: { type: 'varchar(10)', notNull: true, check: "league IN ('5k', '4k', '3k', '2k', '1k', '0k')" },
  });

  pgm.addConstraint('player_availability', 'player_availability_pkey', 'PRIMARY KEY (guild_id, playertag, league)');

  pgm.createIndex('player_availability', ['guild_id', 'l2w_status']);
  pgm.createIndex('player_availability', ['guild_id', 'league'], {
    name: 'player_availability_guild_league_idx',
  });
};

export const down = (pgm) => {
  pgm.dropTable('player_availability');
};
