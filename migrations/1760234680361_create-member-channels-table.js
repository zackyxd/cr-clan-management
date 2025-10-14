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
  pgm.createTable('member_channels', {
    id: 'id',
    guild_id: { type: 'varchar(30)', notNull: true },
    category_id: { type: 'varchar(30)', notNull: true },
    channel_id: { type: 'varchar(30)', notNull: true },
    created_by: { type: 'text[]', notNull: true },
    playertags: { type: 'text[]' },
    discord_ids: { type: 'text[]' },
    last_ping: { type: 'timestamptz', default: null }
  },
    {
      constraints: {
        unique: ['guild_id', 'channel_id']
      }
    });

  pgm.createIndex('member_channels', 'guild_id');

};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('member_channels');
};
