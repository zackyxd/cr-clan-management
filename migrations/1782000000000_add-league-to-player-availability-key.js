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
  pgm.addColumn('player_availability', {
    league: {
      type: 'VARCHAR(10)',
      check: "league IN ('5k', '4k', '3k', '2k', '1k', '0k')",
    },
  });

  pgm.dropColumn('player_availability', 'league_assigned_at');
  pgm.dropColumn('player_availability', 'league_from');
  pgm.dropColumn('player_availability', 'league_target');
  pgm.dropColumn('player_availability', 'league_assigned_by_discord_id');
  pgm.dropColumn('player_availability', 'l2w_marked_by_discord_id');

  pgm.alterColumn('player_availability', 'league', { notNull: true });

  pgm.dropConstraint('player_availability', 'player_availability_pkey');
  pgm.addConstraint('player_availability', 'player_availability_pkey', 'PRIMARY KEY (guild_id, playertag, league)');

  pgm.createIndex('player_availability', ['guild_id', 'league'], {
    name: 'player_availability_guild_league_idx',
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropIndex('player_availability', ['guild_id', 'league'], {
    name: 'player_availability_guild_league_idx',
  });

  pgm.dropConstraint('player_availability', 'player_availability_pkey');
  pgm.addConstraint('player_availability', 'player_availability_pkey', 'PRIMARY KEY (guild_id, playertag)');

  pgm.dropColumn('player_availability', 'league');
};
