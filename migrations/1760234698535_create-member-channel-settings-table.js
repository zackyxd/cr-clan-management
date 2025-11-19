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
  pgm.createTable('member_channel_settings',
    {
      guild_id: { type: 'varchar(30)', notNull: true, references: 'guilds(guild_id)', onDelete: 'CASCADE', primaryKey: true, },
      channel_count: { type: 'integer', default: 1, notNull: true },
      category_id: { type: 'varchar(30)' },
      pin_invite: { type: 'boolean', default: false },
      auto_ping: { type: 'boolean', default: false },
      send_logs: { type: 'boolean', default: false },
      logs_channel_id: { type: 'varchar(30)' },
    }
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('member_channel_settings');
};
