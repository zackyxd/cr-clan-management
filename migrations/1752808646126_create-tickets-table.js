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

  pgm.createTable('ticket_settings', {
    guild_id: { type: 'varchar(30)', references: 'guilds(guild_id)', onDelete: 'CASCADE', primaryKey: true },
    opened_identifier: { type: 'varchar(30)', default: 'ticket' },
    closed_identifier: { type: 'varchar(30)', default: 'closed' },
    allow_append: { type: 'boolean', default: false },
    send_logs: { type: 'boolean', default: false },
    logs_channel_id: { type: 'varchar(30)' }
  });


  pgm.createTable('tickets', {
    guild_id: { type: 'varchar(30)', notNull: true, references: 'guilds(guild_id)', onDelete: 'CASCADE' },
    channel_id: { type: 'varchar(30)', notNull: true },
    initial_ticket_name: { type: 'varchar(30)' }, // Get initial ticket name
    appended_name: { type: 'varchar(30)' }, // Add to ticket name. 
    playertags: { type: 'text[]', default: '{}' }, // array of playertags
    created_by: { type: 'varchar(30)' }, // Discord Id of recruit, update after they enter playertags
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    is_closed: { type: 'boolean', notNull: true, default: false }, // if ticket is closed or open
    closed_at: { type: 'timestamptz' }, // When ticket is closed
  }, {
    constraints: {
      primaryKey: ['guild_id', 'channel_id']
    }
  });

};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('ticket_settings');
  pgm.dropTable('tickets');
};


// This migration contains the info for tickets and any ticket settings.

