// The features that will show under /clan-settings
export const CLAN_FEATURE_SETTINGS = [
  {
    key: 'family_clan',
    label: 'Family Clan',
    description: 'Make this clan part of your clan family.',
    type: 'toggle',
  },
  {
    key: 'nudge_enabled',
    label: 'Nudges',
    description: 'Send pings for clan nudges automatically.',
    type: 'toggle',
  },
  {
    key: 'invites_enabled',
    label: 'Invites',
    description: "Show this clan's invite in the invites channel and ability to generate them for members.",
    type: 'toggle',
  },
  {
    key: 'abbreviation',
    label: 'Abbreviation',
    description: 'Short tag or nickname for the clan.',
    type: 'modal',
  },
  {
    key: 'clan_role_id',
    label: 'Clan Role',
    description: 'Role used for this clan',
    type: 'role',
  },
  {
    // TODO add this to the settings
    key: 'purge_invites',
    label: 'Purge Invites',
    description: 'Purge any active clan invites sent',
    type: 'action',
  },
  // ...add more as needed
];

// The default features
export const DEFAULT_CLAN_SETTINGS = {
  nudge_enabled: false,
  invites_enabled: true,
  abbreviation: '',
  clan_role_id: '',
  // ...add more as needed, matching your CLAN_FEATURE_SETTINGS keys
};
