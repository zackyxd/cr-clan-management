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
    // Race nudge settings (UTC-based)
    // Note: Nudges automatically stop at 9:00am UTC each day (hardcoded)
    race_nudge_channel_id: { type: 'varchar(30)', default: null },
    race_nudge_start_hour: { type: 'integer', default: null }, // 0-23 (UTC)
    race_nudge_start_minute: { type: 'integer', default: null }, // 0-59 (UTC)
    race_nudge_interval_hours: { type: 'integer', default: 3 }, // Hours between nudges
    race_custom_nudge_message: { type: 'text', default: null },
    
    // Auto-post end-of-day stats
    eod_stats_enabled: { type: 'boolean', default: false },
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
    'race_nudge_start_hour',
    'race_nudge_start_minute',
    'race_nudge_interval_hours',
    'race_custom_nudge_message',
    'eod_stats_enabled',
  ]);
};
