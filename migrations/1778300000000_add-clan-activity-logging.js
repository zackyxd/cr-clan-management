/**
 * Add clan activity logging columns to clans table
 * Enables automatic clan change detection (members joining/leaving, promotions, etc.)
 * and optional Discord role management for linked members
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addColumns('clans', {
    // Clan activity logs settings
    clan_logs_enabled: { type: 'boolean', default: true },
    clan_logs_channel_id: { type: 'varchar(30)', default: null },

    // Automatic role management for linked members
    clan_logs_manage_roles: { type: 'boolean', default: false },
    clan_logs_add_role: { type: 'boolean', default: false }, // Add clan role when member joins
    clan_logs_remove_role: { type: 'boolean', default: false }, // Remove clan role when member leaves

    // Activity tracking data
    last_activity_snapshot: { type: 'jsonb', default: null }, // Stores last getClan() response
    last_activity_check_at: { type: 'timestamptz', default: null }, // For distributed scheduling
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumns('clans', [
    'clan_logs_enabled',
    'clan_logs_channel_id',
    'clan_logs_manage_roles',
    'clan_logs_add_role',
    'clan_logs_remove_role',
    'last_activity_snapshot',
    'last_activity_check_at',
  ]);
};
