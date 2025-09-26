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
  pgm.createTable('clan_invites', {
    guild_id: { type: 'varchar(30)', notNull: true },
    clantag: { type: 'varchar(20)', notNull: true },
    invite_link: { type: 'varchar(200)', notNull: true },
    sent_by: { type: 'varchar(30)', notNull: true }, // discord id
    message_id: { type: 'varchar(30)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true }
  },
    {
      constraints: {
        foreignKeys: [
          {
            columns: ['guild_id', 'clantag'],
            references: 'clans(guild_id, clantag)',
            onDelete: 'CASCADE'
          }
        ]
      }
    });


};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('clan_invites');
};
