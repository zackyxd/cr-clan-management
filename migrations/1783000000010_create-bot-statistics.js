export const shorthands = undefined;

export const up = (pgm) => {
  pgm.createTable('bot_statistics', {
    guild_id: { type: 'varchar(30)', primaryKey: true, references: 'guilds(guild_id)', onDelete: 'CASCADE' },
    total_member_channels_created: { type: 'bigint', default: 0, notNull: true },
    total_member_channels_deleted: { type: 'bigint', default: 0, notNull: true },
    total_tickets_with_playertags_linked: { type: 'bigint', default: 0, notNull: true },
    total_playertags_linked_from_tickets: { type: 'bigint', default: 0, notNull: true },
    total_nudges_sent: { type: 'bigint', default: 0, notNull: true },
    total_invite_messages_sent: { type: 'bigint', default: 0, notNull: true },
    total_commands_used: { type: 'bigint', default: 0, notNull: true },
    total_buttons_clicked: { type: 'bigint', default: 0, notNull: true },
    total_modals_submitted: { type: 'bigint', default: 0, notNull: true },
    created_at: { type: 'timestamptz', default: pgm.func('NOW()'), notNull: true },
    updated_at: { type: 'timestamptz', default: pgm.func('NOW()'), notNull: true },
  });
};

export const down = (pgm) => {
  pgm.dropTable('bot_statistics');
};
