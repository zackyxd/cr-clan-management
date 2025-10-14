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

  pgm.createTable('server_settings', {
    guild_id: { type: 'varchar(30)', references: 'guilds(guild_id)', onDelete: 'CASCADE', primaryKey: true },
    max_clans: { type: 'integer', default: 15 },
    max_family_clans: { type: 'integer', default: 10 },
    lower_leader_role_id: { type: 'text[]', default: pgm.func(`'{}'`) },
    higher_leader_role_id: { type: 'text[]', default: pgm.func(`'{}'`) }
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('server_settings');
};
