import { PermissionFlagsBits, CategoryChannel, Guild } from 'discord.js';
import { pool } from '../db.js';

export interface PlayerInfo {
  tag: string;
  name: string;
}

export interface MemberData {
  discordId: string;
  players: PlayerInfo[];
}

/**
 * Get all players from a member channel, sorted alphabetically by name
 */
export async function getChannelMembers(guildId: string, channelId: string): Promise<MemberData[]> {
  const result = await pool.query(
    `
    SELECT members
    FROM member_channels
    WHERE guild_id = $1 AND channel_id = $2
    `,
    [guildId, channelId]
  );

  if (result.rows.length === 0) {
    return [];
  }

  return result.rows[0].members as MemberData[];
}

/**
 * Get all players flattened and sorted
 */
export function getAllPlayersSorted(members: MemberData[]): PlayerInfo[] {
  const allPlayers: PlayerInfo[] = [];
  members.forEach((member) => {
    allPlayers.push(...member.players);
  });
  allPlayers.sort((a, b) => a.name.localeCompare(b.name));
  return allPlayers;
}

/**
 * Get all unique Discord IDs from members
 */
export function getDiscordIds(members: MemberData[]): string[] {
  return members.map((m) => m.discordId);
}

/**
 * Query member channels by Discord ID
 */
export async function getChannelsByDiscordId(guildId: string, discordId: string) {
  const result = await pool.query(
    `
    SELECT channel_id, members
    FROM member_channels
    WHERE guild_id = $1
    AND members @> $2::jsonb
    `,
    [guildId, JSON.stringify([{ discordId }])]
  );

  return result.rows;
}

/**
 * Query member channels by playertag
 */
export async function getChannelsByPlayertag(guildId: string, playertag: string) {
  const result = await pool.query(
    `
    SELECT channel_id, members
    FROM member_channels
    WHERE guild_id = $1
    AND members::text LIKE $2
    `,
    [guildId, `%${playertag}%`]
  );

  return result.rows;
}

/**
 * Build permission overwrites by inheriting category permissions and adding user permissions
 */
export async function buildPermissionOverwrites(
  guild: Guild,
  categoryId: string | null,
  discordIds: string[]
): Promise<
  Array<{
    id: string;
    allow: bigint;
    deny: bigint;
    type: number;
  }>
> {
  const permissionOverwrites: Array<{
    id: string;
    allow: bigint;
    deny: bigint;
    type: number;
  }> = [];

  // Load the category and copy its permission overwrites
  if (categoryId) {
    const category = (await guild.channels.fetch(categoryId)) as CategoryChannel;
    if (category && 'permissionOverwrites' in category) {
      category.permissionOverwrites.cache.forEach((ow) => {
        permissionOverwrites.push({
          id: ow.id,
          allow: ow.allow.bitfield,
          deny: ow.deny.bitfield,
          type: ow.type, // 0 = Role, 1 = Member
        });
      });
      console.log(`Inherited ${permissionOverwrites.length} permission overwrites from category`);
    }
  }

  // Add permissions for each selected user
  for (const discordId of discordIds) {
    permissionOverwrites.push({
      id: discordId,
      allow:
        PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.ReadMessageHistory,
      deny: 0n,
      type: 1, // 1 = User
    });
  }

  return permissionOverwrites;
}

/**
 * Convert finalAccountSelection Map to MemberData array
 */
export function convertToMemberData(finalAccountSelection: Map<string, PlayerInfo[]>): {
  members: MemberData[];
  discordIds: string[];
} {
  const members: MemberData[] = [];
  const discordIds: string[] = [];

  finalAccountSelection.forEach((players, discordId) => {
    discordIds.push(discordId);
    members.push({
      discordId,
      players: players.map((p) => ({ tag: p.tag, name: p.name })),
    });
  });

  return { members, discordIds };
}

/**
 * Insert member channel into database
 */
export async function insertMemberChannel(
  guildId: string,
  categoryId: string | null,
  channelId: string,
  createdBy: string,
  channelName: string,
  clantagFocus: string | null,
  clanNameFocus: string | null,
  members: MemberData[]
): Promise<void> {
  await pool.query(
    `
    INSERT INTO member_channels (guild_id, category_id, channel_id, created_by, channel_name, clantag_focus, clan_name_focus, members)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [guildId, categoryId, channelId, createdBy, channelName, clantagFocus, clanNameFocus, JSON.stringify(members)]
  );
}

/**
 * Add a member to an existing channel
 */
export async function addMemberToChannel(
  guildId: string,
  channelId: string,
  discordId: string,
  players: PlayerInfo[]
): Promise<void> {
  await pool.query(
    `
    UPDATE member_channels
    SET members = members || $1::jsonb
    WHERE guild_id = $2 AND channel_id = $3
    `,
    [JSON.stringify([{ discordId, players }]), guildId, channelId]
  );
}

/**
 * Remove a member from a channel
 */
export async function removeMemberFromChannel(guildId: string, channelId: string, discordId: string): Promise<void> {
  await pool.query(
    `
    UPDATE member_channels
    SET members = (
      SELECT jsonb_agg(elem)
      FROM jsonb_array_elements(members) elem
      WHERE elem->>'discordId' != $1
    )
    WHERE guild_id = $2 AND channel_id = $3
    `,
    [discordId, guildId, channelId]
  );
}

/**
 * Compare channel members with clan members to find who's missing
 */
export function findMissingMembers(channelMembers: MemberData[], clanMembers: Array<{ tag: string; name: string }>) {
  const clanPlayerTags = new Set<string>();

  // Get all player tags from clan members
  clanMembers.forEach((clanMember) => {
    clanPlayerTags.add(clanMember.tag);
  });

  const channelPlayerTags = new Set<string>();
  const missingFromClan: { tag: string; name: string; discordId: string }[] = [];
  const inClan: { tag: string; name: string; discordId: string }[] = [];
  // Check each channel member's players against the clan
  channelMembers.forEach((member) => {
    member.players.forEach((player) => {
      channelPlayerTags.add(player.tag);

      // If this player is not in the clan anymore, they're missing
      if (!clanPlayerTags.has(player.tag)) {
        missingFromClan.push({
          tag: player.tag,
          name: player.name,
          discordId: member.discordId,
        });
      } else {
        inClan.push({
          tag: player.tag,
          name: player.name,
          discordId: member.discordId,
        });
      }
    });
  });

  return {
    missingFromClan,
    inClan,
    totalChannelPlayers: channelPlayerTags.size,
    totalClanMembers: clanMembers.length,
  };
}

/**
 * Get member channel info from database
 */
export async function getMemberChannelInfo(guildId: string, channelId: string) {
  const result = await pool.query(
    `
    SELECT channel_id, clantag_focus, clan_name_focus, members, last_ping
    FROM member_channels
    WHERE guild_id = $1 AND channel_id = $2
    `,
    [guildId, channelId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}
