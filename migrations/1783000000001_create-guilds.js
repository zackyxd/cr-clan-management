export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('guilds', {
    guild_id: { type: 'varchar(30)', primaryKey: true },
    joined_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    in_guild: { type: 'boolean', default: true },
    left_at: { type: 'timestamptz', default: null },
  });
};

export const down = (pgm) => {
  pgm.dropTable('guilds', { cascade: true });
};
