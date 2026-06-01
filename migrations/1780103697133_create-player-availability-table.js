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
  pgm.createTable('player_availability', {
    guild_id: {
      type: 'VARCHAR(20)',
      notNull: true,
      references: 'guilds(guild_id)',
      onDelete: 'CASCADE',
    },
    playertag: {
      type: 'VARCHAR(20)',
      notNull: true,
    },
    // Cached display name — updated on each write
    player_name: {
      type: 'VARCHAR(50)',
      notNull: true,
    },

    // ── L2W / Inactive columns (all nullable; null = not currently L2W/inactive) ──
    l2w_status: {
      type: 'VARCHAR(10)',
      check: "l2w_status IN ('l2w', 'inactive', 'removed')",
    },
    l2w_notes: {
      type: 'TEXT',
    },
    // NULL means indefinite; otherwise the date the status expires
    l2w_duration_date: {
      type: 'DATE',
    },
    l2w_marked_at: {
      type: 'TIMESTAMPTZ',
    },
    l2w_marked_by_discord_id: {
      type: 'VARCHAR(20)',
    },

    // ── League override columns (all nullable; null = natural league from clan trophies) ──
    league_target: {
      type: 'VARCHAR(10)',
    },
    league_from: {
      type: 'VARCHAR(10)',
    },
    league_assigned_at: {
      type: 'TIMESTAMPTZ',
    },
    league_assigned_by_discord_id: {
      type: 'VARCHAR(20)',
    },
  });

  pgm.addConstraint('player_availability', 'player_availability_pkey', 'PRIMARY KEY (guild_id, playertag)');

  pgm.createIndex('player_availability', ['guild_id', 'l2w_status']);
  pgm.createIndex('player_availability', ['guild_id', 'league_target']);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('player_availability');
};
