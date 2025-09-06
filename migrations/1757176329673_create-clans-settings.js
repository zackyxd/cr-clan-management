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
  pgm.createTable('clans', {
    guild_id: { type: 'varchar(30)', references: 'guilds(guild_id)', onDelete: 'CASCADE', notNull: true },
    clantag: { type: 'varchar(20)', notNull: true },
    clan_name: { type: 'varchar(25)' },
    abbreviation: { type: 'varchar(10)', notNull: true },
    family_clan: { type: 'boolean', default: false }
  },
    {
      constraints: {
        primaryKey: ['guild_id', 'clantag'],
        unique: ['guild_id', 'abbreviation']
      }
    });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('clans');
};
