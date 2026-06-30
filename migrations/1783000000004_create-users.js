export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createType('ping_preference', ['none', 'regular', 'all']);

  pgm.createTable(
    'users',
    {
      guild_id: { type: 'varchar(30)', notNull: true, references: 'guilds(guild_id)', onDelete: 'CASCADE' },
      discord_id: { type: 'varchar(30)', notNull: true },
      ping_user: { type: 'ping_preference', default: 'regular', notNull: true },
      is_replace_me: { type: 'boolean', default: false },
      is_replace_me_message_id: { type: 'varchar(30)', default: null, unique: true },
      is_attacking_late: { type: 'boolean', default: false },
      player_settings: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
      replace_me_ping_sent_today: { type: 'boolean', default: false },
      attacking_late_ping_sent_today: { type: 'boolean', default: false },
    },
    {
      constraints: {
        primaryKey: ['guild_id', 'discord_id'],
      },
    },
  );

  pgm.createTable(
    'user_playertags',
    {
      guild_id: { type: 'varchar(30)', notNull: true },
      discord_id: { type: 'varchar(30)', notNull: true },
      playertag: { type: 'varchar(20)', notNull: true },
      current_username: { type: 'varchar(30)', default: null },
      previous_usernames: { type: 'text[]', default: pgm.func("'{}'::text[]") },
    },
    {
      constraints: {
        primaryKey: ['guild_id', 'discord_id', 'playertag'],
        unique: ['guild_id', 'playertag'],
        foreignKeys: [
          {
            columns: ['guild_id'],
            references: 'guilds(guild_id)',
            onDelete: 'CASCADE',
          },
          {
            columns: ['guild_id', 'discord_id'],
            references: 'users(guild_id, discord_id)',
            onDelete: 'CASCADE',
          },
        ],
      },
    },
  );

  pgm.addIndex('user_playertags', ['guild_id', 'discord_id']);
};

export const down = (pgm) => {
  pgm.dropTable('user_playertags');
  pgm.dropTable('users');
  pgm.dropType('ping_preference');
};
