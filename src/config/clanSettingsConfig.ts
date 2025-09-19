// The features that will show
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
    description: "Remove this clan's invite from invites channel and prevent generation for members.",
    type: 'toggle',
  },
  {
    key: 'abbreviation',
    label: 'Abbreviation',
    description: 'Short tag or nickname for the clan.',
    type: 'modal',
  },
  {
    key: 'role_id',
    label: 'Clan Role',
    description: 'Role used for this clan',
    type: 'role',
  },
  // ...add more as needed
];

// The default features
export const DEFAULT_CLAN_SETTINGS = {
  nudge_enabled: false,
  invites_enabled: false,
  abbreviation: '',
  role_id: '',
  // ...add more as needed, matching your CLAN_FEATURE_SETTINGS keys
};
