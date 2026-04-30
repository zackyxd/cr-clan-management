/**
 * Add nudge method selection columns
 * - nudge_method: 'disabled', 'interval', 'hours_before_end'
 * - race_nudge_hours_before_array: Array of hours before war end (9am UTC)
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
    nudge_method: {
      type: 'varchar(20)',
      default: 'interval',
      check: "nudge_method IN ('disabled', 'interval', 'hours_before_end')",
    },
    race_nudge_hours_before_array: { type: 'numeric[]', default: null },
  });

  // Migrate existing data: if nudge_enabled is true, set method to 'interval', else 'disabled'
  pgm.sql(`
    UPDATE clans 
    SET nudge_method = CASE 
      WHEN nudge_enabled = true THEN 'interval' 
      ELSE 'disabled' 
    END
    WHERE nudge_method = 'interval';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumns('clans', ['nudge_method', 'race_nudge_hours_before_array']);
};
