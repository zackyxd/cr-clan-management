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
  pgm.createTable('bot_statistics', {
    guild_id: {
      type: 'VARCHAR(20)',
      primaryKey: true,
      references: 'guilds(guild_id)',
      onDelete: 'CASCADE',
    },

    // Member Channels
    total_member_channels_created: {
      type: 'BIGINT',
      default: 0,
      notNull: true,
    },
    total_member_channels_deleted: {
      type: 'BIGINT',
      default: 0,
      notNull: true,
    },

    // Tickets & Linking
    total_tickets_with_playertags_linked: {
      type: 'BIGINT',
      default: 0,
      notNull: true,
    },
    total_playertags_linked_from_tickets: {
      type: 'BIGINT',
      default: 0,
      notNull: true,
    },

    // Nudges
    total_nudges_sent: {
      type: 'BIGINT',
      default: 0,
      notNull: true,
    },

    // Invites
    total_invite_messages_sent: {
      type: 'BIGINT',
      default: 0,
      notNull: true,
    },

    // Interaction Analytics
    total_commands_used: {
      type: 'BIGINT',
      default: 0,
      notNull: true,
    },
    total_buttons_clicked: {
      type: 'BIGINT',
      default: 0,
      notNull: true,
    },
    total_modals_submitted: {
      type: 'BIGINT',
      default: 0,
      notNull: true,
    },

    // Timestamps
    created_at: {
      type: 'TIMESTAMPTZ',
      default: pgm.func('NOW()'),
      notNull: true,
    },
    updated_at: {
      type: 'TIMESTAMPTZ',
      default: pgm.func('NOW()'),
      notNull: true,
    },
  });

  // Create index for efficient lookups
  pgm.createIndex('bot_statistics', 'guild_id');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('bot_statistics');
};
