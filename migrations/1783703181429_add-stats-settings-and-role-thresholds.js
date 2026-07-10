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
  pgm.createTable('stats_settings', {
    guild_id: { type: 'varchar(30)', references: 'guilds(guild_id)', onDelete: 'CASCADE', primaryKey: true },
    colosseum_5k_channel_id: { type: 'varchar(30)', default: null },
    colosseum_4k_channel_id: { type: 'varchar(30)', default: null },
  });

  pgm.createTable(
    'stats_role_thresholds',
    {
      guild_id: { type: 'varchar(30)', references: 'guilds(guild_id)', onDelete: 'CASCADE', notNull: true },
      league: { type: 'varchar(5)', notNull: true, check: "league IN ('5k', '4k')" },
      kind: { type: 'varchar(15)', notNull: true, check: "kind IN ('average', 'colosseum')" },
      threshold: { type: 'integer', notNull: true },
      role_id: { type: 'varchar(30)', notNull: true },
    },
    {
      constraints: {
        primaryKey: ['guild_id', 'league', 'kind', 'threshold'],
      },
    },
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('stats_role_thresholds');
  pgm.dropTable('stats_settings');
};
