export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable(
    'clans',
    {
      guild_id: { type: 'varchar(30)', references: 'guilds(guild_id)', onDelete: 'CASCADE', notNull: true },
      clantag: { type: 'varchar(20)', notNull: true },
      clan_name: { type: 'varchar(25)' },
      clan_trophies: { type: 'integer', notNull: true },
      abbreviation: { type: 'varchar(10)' },
      family_clan: { type: 'boolean', default: false },
      nudge_enabled: { type: 'boolean', default: true },
      invites_enabled: { type: 'boolean', default: false },
      clan_role_id: { type: 'varchar(30)', default: null },
      staff_channel_id: { type: 'varchar(30)', default: null },
      race_ping_channel_id: { type: 'varchar(30)', default: null },
      ping_attacking_late: { type: 'boolean', default: false },
      ping_replace_me: { type: 'boolean', default: false },
      ping_replace_me_role_id: { type: 'varchar(30)', default: null },
      show_clan_link: { type: 'boolean', default: true },
      // Race tracking
      race_nudge_channel_id: { type: 'varchar(30)', default: null },
      race_nudge_start_hour: { type: 'integer', default: 2 },
      race_nudge_start_minute: { type: 'integer', default: 0 },
      race_nudge_interval_hours: { type: 'decimal', default: 2.0 },
      race_custom_nudge_message: { type: 'text', default: null },
      eod_stats_enabled: { type: 'boolean', default: false },
      nudge_method: {
        type: 'varchar(20)',
        default: 'interval',
        check: "nudge_method IN ('disabled', 'interval', 'hours_before_end')",
      },
      race_nudge_hours_before_array: { type: 'numeric[]', default: null },
      // Clan activity logging
      clan_logs_enabled: { type: 'boolean', default: true },
      clan_logs_channel_id: { type: 'varchar(30)', default: null },
      clan_logs_manage_roles: { type: 'boolean', default: false },
      clan_logs_add_role: { type: 'boolean', default: false },
      clan_logs_remove_role: { type: 'boolean', default: false },
      last_activity_snapshot: { type: 'jsonb', default: null },
      last_activity_check_at: { type: 'timestamptz', default: null },
      // Stats header colors
      header_bg_hex: { type: 'varchar(7)' },
      header_text_hex: { type: 'varchar(7)' },
      // L2W
      l2w_clan: { type: 'boolean', default: false },
    },
    {
      constraints: {
        primaryKey: ['guild_id', 'clantag'],
        unique: ['guild_id', 'abbreviation'],
      },
    },
  );
};

export const down = (pgm) => {
  pgm.dropTable('clans', { cascade: true });
};
