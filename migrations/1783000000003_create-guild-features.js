export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable(
    'guild_features',
    {
      guild_id: { type: 'varchar(30)', references: 'guilds(guild_id)', onDelete: 'CASCADE' },
      feature_name: { type: 'varchar(50)' },
      is_enabled: { type: 'boolean', default: false },
    },
    {
      constraints: {
        primaryKey: ['guild_id', 'feature_name'],
      },
    },
  );
};

export const down = (pgm) => {
  pgm.dropTable('guild_features');
};
