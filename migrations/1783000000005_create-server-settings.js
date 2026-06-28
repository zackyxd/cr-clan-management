export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('server_settings', {
    guild_id: { type: 'varchar(30)', references: 'guilds(guild_id)', onDelete: 'CASCADE', primaryKey: true },
    max_clans: { type: 'integer', default: 15 },
    max_family_clans: { type: 'integer', default: 10 },
    logs_channel_id: { type: 'varchar(30)', default: null },
    lower_leader_role_id: { type: 'text[]', default: pgm.func(`'{}'`) },
    higher_leader_role_id: { type: 'text[]', default: pgm.func(`'{}'`) },
    replace_me_role_id: { type: 'varchar(30)', default: null },
    attacking_late_role_id: { type: 'varchar(30)', default: null },
    send_logs: { type: 'boolean', default: false, notNull: true },
    clan_roles_required_role_id: { type: 'varchar(30)' },
    stats_spreadsheetid: { type: 'varchar(75)', default: null },
    last_daily_reset: { type: 'timestamptz', default: null },
  });

  pgm.createTable('link_settings', {
    guild_id: { type: 'varchar(30)', references: 'guilds(guild_id)', onDelete: 'CASCADE', primaryKey: true },
    rename_players: { type: 'boolean', default: false },
    max_player_links: { type: 'integer', default: 10 },
  });
};

export const down = (pgm) => {
  pgm.dropTable('link_settings');
  pgm.dropTable('server_settings');
};
