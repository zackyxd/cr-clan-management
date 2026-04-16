/**
 * Add race tracking settings columns to clans table
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
    // Race tracking / nudge settings
    race_nudge_channel_id: { type: 'varchar(30)', default: null },
    race_nudge_start_time: { type: 'time', default: null },
    race_nudge_interval_hours: { type: 'integer', default: 2 },
    race_nudge_count_per_day: { type: 'integer', default: 4 },
    race_custom_nudge_message: { type: 'text', default: null },

    // Auto-post settings
    race_auto_post_enabled: { type: 'boolean', default: false },
    race_auto_post_channel_id: { type: 'varchar(30)', default: null },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumns('clans', [
    'race_nudge_channel_id',
    'race_nudge_start_time',
    'race_nudge_interval_hours',
    'race_nudge_count_per_day',
    'race_attack_warning_threshold',
    'race_custom_nudge_message',
    'race_auto_post_enabled',
    'race_auto_post_channel_id',
  ]);
};
