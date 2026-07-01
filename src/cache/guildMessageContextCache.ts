import { pool } from '../db.js';

export interface GuildMessageContext {
  lowerLeaderRoleIds: string[];
  higherLeaderRoleIds: string[];
  attackingLateRoleId: string | null;
  replaceMeRoleId: string | null;
  clanInviteChannelId: string | null;
}

const TTL_MS = 60 * 1000;
const cache = new Map<string, { data: GuildMessageContext; expiry: number }>();

async function fetchGuildMessageContext(guildId: string): Promise<GuildMessageContext> {
  const { rows } = await pool.query(
    `SELECT
       ss.lower_leader_role_id,
       ss.higher_leader_role_id,
       ss.attacking_late_role_id,
       ss.replace_me_role_id,
       cis.channel_id AS clan_invite_channel_id
     FROM server_settings ss
     LEFT JOIN clan_invite_settings cis ON cis.guild_id = ss.guild_id
     WHERE ss.guild_id = $1`,
    [guildId],
  );

  const row = rows[0] ?? {};

  return {
    lowerLeaderRoleIds: row.lower_leader_role_id ?? [],
    higherLeaderRoleIds: row.higher_leader_role_id ?? [],
    attackingLateRoleId: row.attacking_late_role_id ?? null,
    replaceMeRoleId: row.replace_me_role_id ?? null,
    clanInviteChannelId: row.clan_invite_channel_id ?? null,
  };
}

/** Per-guild settings needed by messageCreate handlers, cached for TTL_MS to avoid a DB round-trip per message. */
export async function getGuildMessageContext(guildId: string): Promise<GuildMessageContext> {
  const cached = cache.get(guildId);
  if (cached && Date.now() < cached.expiry) return cached.data;

  const data = await fetchGuildMessageContext(guildId);
  cache.set(guildId, { data, expiry: Date.now() + TTL_MS });
  return data;
}

/** Call after updating server_settings, clan_invite_settings, or clans so the next message picks up fresh data. */
export function invalidateGuildMessageContext(guildId: string): void {
  cache.delete(guildId);
}
