export interface InviteLink {
  id: number;
  guild_id: string;
  clan_name: string;
  clantag: string;
  invite_link: string;
  created_by: string;
  created_at: Date;
  expires_at: Date;
  is_expired: boolean;
}

export interface InviteLinkMessage {
  id: number;
  invite_link_id: number;
  guild_id: string;
  channel_id: string;
  message_id: string;
  source_type: string;
  sent_by_id?: string;
  created_at: Date;
}

export interface ParsedInviteLink {
  clantag: string;
  fullLink: string;
  platform: 'android' | 'ios';
}

export type InviteSourceType =
  | 'command'
  | 'member_channel_ping'
  | 'auto_post'
  | 'manual_send'
  | 'update_command'
  | 'modal_submit'
  | '/send-invite'
  | '/update-clan-invite'
  | 'Member Channel Ping'
  | 'Auto Member Channel Ping';
