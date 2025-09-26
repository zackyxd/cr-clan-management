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
  pgm.createType('delete_method_type', ['delete', 'update']);

  pgm.createTable('clan_invite_settings', {
    guild_id: { type: 'varchar(30)', notNull: true, references: 'guilds(guild_id)', onDelete: 'CASCADE', primaryKey: true, },
    channel_id: { type: 'varchar(30)' },
    message_id: { type: 'varchar(30)' },
    pin_message: { type: 'boolean', default: false },
    delete_method: { type: 'delete_method_type', notNull: true, default: 'update' },
    show_inactive: { type: 'boolean', default: false }, // show inactive
    ping_expired: { type: 'boolean', default: false }, // ping role if available
    send_logs: { type: 'boolean', default: false }, // send info about clan invite links (updated / sent out)
    logs_channel_id: { type: 'varchar(30)' }
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('clan_invite_settings');
  pgm.dropType('delete_method_type');
};
