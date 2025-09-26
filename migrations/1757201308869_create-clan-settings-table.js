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
  pgm.createTable('clan_settings', {
    guild_id: { type: 'varchar(30)', notNull: true },
    clantag: { type: 'varchar(20)', notNull: true },
    settings: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") }
  });

  pgm.addConstraint('clan_settings', 'clan_settings_pk', {
    primaryKey: ['guild_id', 'clantag']
  });

  pgm.addConstraint('clan_settings', 'clan_settings_clan_fk', {
    foreignKeys: {
      columns: ['guild_id', 'clantag'],
      references: 'clans(guild_id, clantag)',
      onDelete: 'CASCADE'
    }
  });

  pgm.createIndex('clan_settings', 'settings', { method: 'gin' });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('clan_settings');
};
