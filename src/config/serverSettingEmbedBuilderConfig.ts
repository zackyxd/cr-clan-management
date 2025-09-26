// This will be for the embed builder when server-settings is ran:

const EMBED_SERVER_FEATURE_CONFIG = {
  ticket_settings: {
    displayName: 'tickets',
    description: 'Ticket features handles everything related to tickets and ensuring you can handle new members.',
  },
  clan_invite_settings: {
    displayName: 'clan_invites',
    description: 'Clan invite settings manage how invites are handled and displayed.',
  },
  link_settings: {
    displayName: 'links',
    description:
      'Links feature handles everything related to linking Discord accounts to their Clash Royale playertags.',
  },
} as const;

export default EMBED_SERVER_FEATURE_CONFIG;
