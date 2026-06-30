export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('ticket_settings', {
    guild_id: { type: 'varchar(30)', references: 'guilds(guild_id)', onDelete: 'CASCADE', primaryKey: true },
    opened_identifier: { type: 'varchar(30)', default: 'ticket' },
    closed_identifier: { type: 'varchar(30)', default: 'closed' },
    allow_append: { type: 'boolean', default: false },
    send_logs: { type: 'boolean', default: false },
    welcome_message: { type: 'text', default: null },
  });

  pgm.createTable(
    'tickets',
    {
      guild_id: { type: 'varchar(30)', notNull: true, references: 'guilds(guild_id)', onDelete: 'CASCADE' },
      channel_id: { type: 'varchar(30)', notNull: true },
      initial_ticket_name: { type: 'varchar(30)' },
      appended_name: { type: 'varchar(30)' },
      appended_at: { type: 'timestamptz' },
      playertags: { type: 'text[]', default: pgm.func(`'{}'`) },
      created_by: { type: 'varchar(30)' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      is_closed: { type: 'boolean', notNull: true, default: false },
      closed_at: { type: 'timestamptz' },
    },
    {
      constraints: {
        primaryKey: ['guild_id', 'channel_id'],
      },
    },
  );
};

export const down = (pgm) => {
  pgm.dropTable('tickets');
  pgm.dropTable('ticket_settings');
};
