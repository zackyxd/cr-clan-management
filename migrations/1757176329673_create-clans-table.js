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
    clan_trophies: { type: 'integer', notNull: true },

    // Clan Settings - Individual columns instead of JSONB
    abbreviation: { type: 'varchar(10)' },
    family_clan: { type: 'boolean', default: false },
    nudge_enabled: { type: 'boolean', default: false },
    invites_enabled: { type: 'boolean', default: false },
    clan_role_id: { type: 'varchar(30)' }, // Discord role ID

    // Clan Link Settings
    active_clan_link: { type: 'varchar(200)' },
    active_clan_link_expiry_time: { type: 'timestamptz', default: null },
    show_clan_link: { type: 'boolean', default: true }
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
