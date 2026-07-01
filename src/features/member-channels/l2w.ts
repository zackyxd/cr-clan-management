import { pool } from '../../db.js';
import { CR_API } from '../../api/CR_API.js';

/** Whether a member channel's name marks it as an "L2W" (multi-clan) channel. */
export function isL2WChannelName(channelName: string): boolean {
  return channelName.toLowerCase().includes('l2w');
}

export interface L2WClan {
  clantag: string;
  clanName: string;
}

/** All clans in the guild flagged as `l2w_clan`. */
export async function getL2WClans(guildId: string): Promise<L2WClan[]> {
  const result = await pool.query(`SELECT clantag, clan_name FROM clans WHERE guild_id = $1 AND l2w_clan = TRUE`, [
    guildId,
  ]);
  return result.rows.map((row) => ({ clantag: row.clantag, clanName: row.clan_name }));
}

/**
 * Combined set of every member playertag across all L2W clans in the guild.
 * Clans that fail to fetch from the CR API are silently skipped.
 */
export async function getL2WMemberTags(guildId: string): Promise<Set<string>> {
  const clans = await getL2WClans(guildId);
  const tags = new Set<string>();

  await Promise.all(
    clans.map(async (clan) => {
      const clanData = await CR_API.getClan(clan.clantag);
      if (!('error' in clanData) && clanData) {
        clanData.memberList.forEach((member) => tags.add(member.tag));
      }
    }),
  );

  return tags;
}

/** clantags of L2W clans that currently have an active, non-expired invite link and invites enabled. */
export async function getL2WClansWithActiveInvites(guildId: string): Promise<L2WClan[]> {
  const result = await pool.query(
    `SELECT DISTINCT ON (cil.clantag) cil.clantag, c.clan_name
     FROM clan_invite_links cil
     JOIN clans c ON c.guild_id = cil.guild_id AND c.clantag = cil.clantag
     WHERE cil.guild_id = $1
       AND c.l2w_clan = TRUE
       AND c.invites_enabled = TRUE
       AND cil.expires_at > NOW() AND cil.is_expired = FALSE
     ORDER BY cil.clantag, cil.created_at DESC`,
    [guildId],
  );
  return result.rows.map((row) => ({ clantag: row.clantag, clanName: row.clan_name }));
}
