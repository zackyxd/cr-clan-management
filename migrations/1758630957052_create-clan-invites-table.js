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
  pgm.createTable('clan_invite_links', {
    id: { type: 'serial', primaryKey: true },
    guild_id: { type: 'varchar(30)', notNull: true },
    clantag: { type: 'varchar(20)', notNull: true },
    invite_link: { type: 'varchar(200)', notNull: true },
    created_by: { type: 'varchar(30)', notNull: true }, // discord id
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
    is_expired: { type: 'boolean', default: false }
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


  pgm.createTable('invite_link_messages', {
    id: { type: 'serial', primaryKey: true },
    invite_link_id: {
      type: 'integer',
      notNull: true,
      references: 'clan_invites_links(id)',
      onDelete: 'CASCADE'
    },
    guild_id: { type: 'varchar(30)', notNull: true },
    channel_id: { type: 'varchar(30)', notNull: true },
    message_id: { type: 'varchar(30)', notNull: true },
    source_type: { type: 'varchar(50)', notNull: true },
    sent_by_id: { type: 'varchar(30)', notNull: true },
    created_at: { type: 'timestamptz', default: pgm.func('now()') }
  },
    {
      constraints: {
        unique: [['channel_id', 'message_id']]
      }
    });

};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('invite_link_messages');
  pgm.dropTable('clan_invite_links');
};
