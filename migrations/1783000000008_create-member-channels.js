export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable(
    'member_channels',
    {
      id: 'id',
      guild_id: { type: 'varchar(30)', notNull: true, references: 'guilds(guild_id)', onDelete: 'CASCADE' },
      category_id: { type: 'varchar(30)', notNull: true },
      channel_id: { type: 'varchar(30)', notNull: true },
      created_by: { type: 'varchar(30)', notNull: true },
      channel_name: { type: 'varchar(50)', notNull: true },
      last_renamed_at: { type: 'timestamptz', default: null },
      clantag_focus: { type: 'varchar(20)' },
      clan_name_focus: { type: 'varchar(30)' },
      members: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
      last_ping: { type: 'timestamptz', default: null },
      is_locked: { type: 'boolean', default: false },
      auto_delete_at: { type: 'timestamptz', default: null },
      current_delete_count: { type: 'integer', default: 0 },
      current_bulk_delete_count: { type: 'integer', default: 0 },
      delete_confirmed_by: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
      bulk_delete_confirmed_by: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
      is_deleted: { type: 'boolean', default: false },
      deleted_at: { type: 'timestamptz', default: null },
    },
    {
      constraints: {
        unique: ['guild_id', 'channel_id'],
      },
    },
  );

  pgm.createIndex('member_channels', 'guild_id');

  pgm.createTable('member_channel_settings', {
    guild_id: { type: 'varchar(30)', notNull: true, references: 'guilds(guild_id)', onDelete: 'CASCADE', primaryKey: true },
    channel_count: { type: 'integer', default: 1, notNull: true },
    category_id: { type: 'varchar(30)' },
    pin_invite: { type: 'boolean', default: false },
    delete_confirm_count: { type: 'integer', default: 1 },
    auto_ping: { type: 'boolean', default: false },
    send_logs: { type: 'boolean', default: false },
  });
};

export const down = (pgm) => {
  pgm.dropTable('member_channel_settings');
  pgm.dropTable('member_channels');
};
