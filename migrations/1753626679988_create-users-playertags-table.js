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
  pgm.createTable('users', {
    guild_id: { type: 'varchar(30)', notNull: true, references: 'guilds(guild_id)', onDelete: 'CASCADE' },
    discord_id: { type: 'varchar(30)', notNull: true },
    ping_user: { type: 'boolean', default: true },
    is_replace_me: { type: 'boolean', default: false, },
    is_replace_me_message_id: { type: 'varchar(30)', default: null, unique: true },
    is_attacking_late: { type: 'boolean', default: false }
  }, {
    constraints: {
      primaryKey: ['guild_id', 'discord_id']
    }
  });

  pgm.createTable('user_playertags', {
    guild_id: { type: 'varchar(30)', notNull: true },
    discord_id: { type: 'varchar(30)', notNull: true },
    playertag: { type: 'varchar(20)', notNull: true }
  }, {
    constraints: {
      primaryKey: ['guild_id', 'discord_id', 'playertag'],
      unique: ['guild_id', 'playertag'],
      foreignKeys: [{
        columns: ['guild_id'],
        references: 'guilds(guild_id)',
        onDelete: 'CASCADE'
      },
      {
        columns: ['guild_id', 'discord_id'],
        references: 'users(guild_id, discord_id)',
        onDelete: 'CASCADE'
      }]
    },
  });
  pgm.addIndex('user_playertags', ['guild_id', 'discord_id']); // Optional: if you query by both
};


/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropIndex('user_playertags', ['guild_id', 'discord_id']);
  pgm.dropTable('user_playertags');
  pgm.dropTable('users');
};
