import { EmbedBuilder, Guild, GuildMember } from 'discord.js';
import { pool } from '../../db.js';
import logger from '../../logger.js';
import { CR_API, isFetchError, normalizeTag } from '../../api/CR_API.js';
import { buildGetFamilyClans } from '../../sql_queries/clans.js';
import { EmbedColor } from '../../types/EmbedUtil.js';
import { readAveragesSheets, type AveragesEntry } from './averagesLookup.js';
import { isColosseumWeekFromStandings } from './statsUtil.js';
import { getAllRoleTiers, type League, type RoleTier, type ThresholdKind } from './roleThresholds.js';

export interface MemberRoleChange {
  discordId: string;
  playerName: string;
  tag: string;
  league: League;
  kind: ThresholdKind;
  /** Fame/attack average for 'average' changes, colosseum week fame for 'colosseum' changes. */
  score: number;
  /** The tier's configured cutoff (e.g. 210), not the member's actual score. */
  threshold: number;
  addRoleId: string;
  removeRoleIds: string[];
}

export interface ClanChangeGroup {
  abbr: string;
  clanName: string;
  /** race_nudge_channel_id of the matched clan; null means roles apply but no message can be sent. */
  channelId: string | null;
  changes: MemberRoleChange[];
}

export interface ColosseumChangeGroup {
  league: League;
  channelId: string | null;
  changes: MemberRoleChange[];
}

export interface AverageRolesComputation {
  guildId: string;
  isColosseumWeek: boolean;
  colosseumWeekLabel: string | null;
  clanGroups: ClanChangeGroup[];
  colosseumGroups: ColosseumChangeGroup[];
  notes: string[];
  totalChanges: number;
}

interface Candidate {
  discordId: string;
  entry: AveragesEntry;
  score: number;
}

/**
 * Reads both Averages sheets and works out every role change to preview:
 * average-ladder roles grouped by the player's last clan, plus colosseum-ladder
 * roles per league when the newest tracked week is a colosseum week.
 */
export async function computeAverageRoleChanges(
  guild: Guild,
  spreadsheetId: string,
): Promise<{ error?: string; computation?: AverageRolesComputation }> {
  const tiers = await getAllRoleTiers(guild.id);
  const hasAnyAverageTier = tiers['5k'].average.length + tiers['4k'].average.length > 0;
  if (!hasAnyAverageTier) {
    return {
      error: 'No average role thresholds are configured. Set them up in `/server-settings` → **Stats** first.',
    };
  }

  const sheetData = await readAveragesSheets(spreadsheetId);
  if (sheetData.length === 0) {
    return { error: 'No "5k Averages" / "4k Averages" sheets were found in the configured spreadsheet.' };
  }

  const notes: string[] = [];

  await guild.roles.fetch();
  const filterLadder = (ladder: RoleTier[]): RoleTier[] =>
    ladder.filter((tier) => {
      if (guild.roles.cache.has(tier.roleId)) return true;
      notes.push(`⚠️ The role for the **${tier.threshold}+** tier was deleted — tier skipped.`);
      return false;
    });

  const linkedRes = await pool.query<{ playertag: string; discord_id: string }>(
    `SELECT playertag, discord_id FROM user_playertags WHERE guild_id = $1`,
    [guild.id],
  );
  const linkedDiscordIds = new Map(linkedRes.rows.map((row) => [normalizeTag(row.playertag), row.discord_id]));

  const clansRes = await pool.query<{ clan_name: string; abbreviation: string; race_nudge_channel_id: string | null }>(
    `SELECT clan_name, abbreviation, race_nudge_channel_id FROM clans WHERE guild_id = $1 AND abbreviation IS NOT NULL`,
    [guild.id],
  );
  const clansByAbbr = new Map(
    clansRes.rows.map((row) => [
      row.abbreviation.toUpperCase(),
      { clanName: row.clan_name, channelId: row.race_nudge_channel_id },
    ]),
  );

  // Colosseum detection: the newest week header on a sheet is a colosseum week when
  // the matching river race log period pays 20+ trophies to two or more clans.
  const hasAnyColosseumTier = tiers['5k'].colosseum.length + tiers['4k'].colosseum.length > 0;
  const newestLabels = new Set(sheetData.map((sheet) => sheet.weekLabels[0]).filter(Boolean));
  let colosseumKeys = new Set<string>();
  if (hasAnyColosseumTier && newestLabels.size > 0) {
    colosseumKeys = await detectColosseumWeeks(guild.id, newestLabels);
  }

  // Best qualifying account per (league, user); a user with several linked accounts
  // is judged on whichever account scores highest.
  const averageCandidates = new Map<string, Candidate>();
  const colosseumCandidates = new Map<string, Candidate>();
  let isColosseumWeek = false;
  let colosseumWeekLabel: string | null = null;

  const averageLadders: Record<League, RoleTier[]> = {
    '5k': filterLadder(tiers['5k'].average),
    '4k': filterLadder(tiers['4k'].average),
  };
  const colosseumLadders: Record<League, RoleTier[]> = {
    '5k': filterLadder(tiers['5k'].colosseum),
    '4k': filterLadder(tiers['4k'].colosseum),
  };

  // Ladders are sorted highest first, so the last tier is the entry cutoff.
  // Players below it can never earn a role, so they're excluded before the
  // member fetch — that's what keeps the fetch count small.
  const minTier = (ladder: RoleTier[]): number =>
    ladder.length > 0 ? ladder[ladder.length - 1].threshold : Infinity;

  for (const sheet of sheetData) {
    const league = sheet.league;
    const newestLabel = sheet.weekLabels[0];
    const newestIsColosseum = Boolean(newestLabel) && colosseumKeys.has(newestLabel);
    if (newestIsColosseum) {
      isColosseumWeek = true;
      colosseumWeekLabel = newestLabel;
    }

    for (const entry of sheet.entries) {
      const discordId = linkedDiscordIds.get(entry.tag);
      if (!discordId) continue; // unlinked rows are skipped silently

      if (entry.average !== null && entry.average >= minTier(averageLadders[league])) {
        const key = `${league}|${discordId}`;
        const existing = averageCandidates.get(key);
        if (!existing || entry.average > existing.score) {
          averageCandidates.set(key, { discordId, entry, score: entry.average });
        }
      }

      if (newestIsColosseum) {
        const colosseumWeek = entry.weeks.find((week) => week.label === newestLabel);
        if (colosseumWeek?.fame != null && colosseumWeek.fame >= minTier(colosseumLadders[league])) {
          const key = `${league}|${discordId}`;
          const existing = colosseumCandidates.get(key);
          if (!existing || colosseumWeek.fame > existing.score) {
            colosseumCandidates.set(key, { discordId, entry, score: colosseumWeek.fame });
          }
        }
      }
    }
  }

  // Fetch every involved member (bulk gateway requests with REST fallback).
  const allDiscordIds = [
    ...new Set([...averageCandidates.values(), ...colosseumCandidates.values()].map((c) => c.discordId)),
  ];
  const members = await fetchMembersByIds(guild, allDiscordIds);
  if (allDiscordIds.length > 0 && members.size === 0) {
    return { error: 'Could not fetch any server members to check roles against. Please try again.' };
  }

  const clanGroupsByAbbr = new Map<string, ClanChangeGroup>();

  for (const [key, candidate] of averageCandidates) {
    const league = key.split('|')[0] as League;
    const member = members.get(candidate.discordId);
    if (!member) continue; // left the server

    const change = computeLadderChange(member, averageLadders[league], candidate, league, 'average');
    if (!change) continue;

    // Player's last clan doesn't match any of this server's clans (left the family) — skip.
    const abbr = candidate.entry.clanAbbr.toUpperCase();
    const clan = clansByAbbr.get(abbr);
    if (!clan) continue;

    let group = clanGroupsByAbbr.get(abbr);
    if (!group) {
      group = { abbr, clanName: clan.clanName, channelId: clan.channelId, changes: [] };
      clanGroupsByAbbr.set(abbr, group);
    }
    group.changes.push(change);
  }

  const colosseumGroups: ColosseumChangeGroup[] = [];
  if (colosseumCandidates.size > 0) {
    const channelsRes = await pool.query<{
      colosseum_5k_channel_id: string | null;
      colosseum_4k_channel_id: string | null;
    }>(`SELECT colosseum_5k_channel_id, colosseum_4k_channel_id FROM stats_settings WHERE guild_id = $1`, [guild.id]);
    const colosseumChannels: Record<League, string | null> = {
      '5k': channelsRes.rows[0]?.colosseum_5k_channel_id || null,
      '4k': channelsRes.rows[0]?.colosseum_4k_channel_id || null,
    };

    for (const league of ['5k', '4k'] as const) {
      const changes: MemberRoleChange[] = [];
      for (const [key, candidate] of colosseumCandidates) {
        if (!key.startsWith(`${league}|`)) continue;
        const member = members.get(candidate.discordId);
        if (!member) continue;

        const change = computeLadderChange(member, colosseumLadders[league], candidate, league, 'colosseum');
        if (change) changes.push(change);
      }
      if (changes.length > 0) {
        changes.sort((a, b) => b.score - a.score);
        colosseumGroups.push({ league, channelId: colosseumChannels[league], changes });
        if (!colosseumChannels[league]) {
          notes.push(
            `⚠️ No **${league} Colosseum Channel** is set (\`/server-settings\` → Stats) — those roles will be applied without an announcement.`,
          );
        }
      }
    }
  }

  const clanGroups = [...clanGroupsByAbbr.values()].sort((a, b) => a.abbr.localeCompare(b.abbr));
  for (const group of clanGroups) {
    group.changes.sort((a, b) => b.score - a.score);
    if (!group.channelId) {
      notes.push(
        `⚠️ **${group.abbr}** has no nudge channel set — those roles will be applied without an announcement.`,
      );
    }
  }

  const totalChanges =
    clanGroups.reduce((sum, group) => sum + group.changes.length, 0) +
    colosseumGroups.reduce((sum, group) => sum + group.changes.length, 0);

  return {
    computation: {
      guildId: guild.id,
      isColosseumWeek,
      colosseumWeekLabel,
      clanGroups,
      colosseumGroups,
      notes,
      totalChanges,
    },
  };
}

/**
 * Returns which season-week keys (e.g. "133-4") are colosseum weeks, checking
 * family clan river race logs until one covers every label we care about.
 */
async function detectColosseumWeeks(guildId: string, wantedLabels: Set<string>): Promise<Set<string>> {
  const colosseumKeys = new Set<string>();
  const familyRes = await pool.query<{ clantag: string }>(buildGetFamilyClans(guildId));

  for (const clan of familyRes.rows) {
    const log = await CR_API.getRiverRaceLog(clan.clantag);
    if (isFetchError(log)) continue;

    const seenKeys = new Set<string>();
    for (const period of log.items) {
      const key = `${period.seasonId}-${period.sectionIndex + 1}`;
      seenKeys.add(key);
      if (isColosseumWeekFromStandings(period.standings)) colosseumKeys.add(key);
    }

    if ([...wantedLabels].every((label) => seenKeys.has(label))) break;
  }

  return colosseumKeys;
}

/**
 * Fetches members in bulk gateway requests (100 ids each — fast, and the chunk
 * payloads carry current role data straight from Discord, not the local cache).
 * Anyone the gateway didn't return is retried individually over REST with
 * `force: true`, which distinguishes "left the server" from a dropped/partial
 * chunk — the bot runs without the GuildMembers intent, so chunk responses
 * can't be fully trusted on their own. A member missing from the result has
 * genuinely left the server.
 */
async function fetchMembersByIds(guild: Guild, discordIds: string[]): Promise<Map<string, GuildMember>> {
  const members = new Map<string, GuildMember>();
  const missing = new Set(discordIds);

  for (let i = 0; i < discordIds.length; i += 100) {
    const chunk = discordIds.slice(i, i + 100);
    try {
      const fetched = await guild.members.fetch({ user: chunk, time: 30_000 });
      for (const member of fetched.values()) {
        members.set(member.id, member);
        missing.delete(member.id);
      }
    } catch (error) {
      logger.warn(`[Average Roles] Gateway member chunk failed for guild:${guild.id}, falling back to REST:`, error);
    }
  }

  const missingIds = [...missing];
  const concurrency = 10;
  for (let i = 0; i < missingIds.length; i += concurrency) {
    const chunk = missingIds.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (discordId) => {
        try {
          const member = await guild.members.fetch({ user: discordId, force: true });
          members.set(discordId, member);
        } catch {
          // Left the server or unknown user — skipped.
        }
      }),
    );
  }

  return members;
}

/**
 * Decides the change for one member on one ladder: the highest tier their score
 * reaches, unless they already hold that tier or a higher one. Lower tiers they
 * hold are removed so only the highest earned role remains. Never downgrades.
 */
function computeLadderChange(
  member: GuildMember,
  ladder: RoleTier[],
  candidate: Candidate,
  league: League,
  kind: ThresholdKind,
): MemberRoleChange | null {
  const target = ladder.find((tier) => candidate.score >= tier.threshold); // ladder is sorted highest first
  if (!target) return null;

  const ownedTiers = ladder.filter((tier) => member.roles.cache.has(tier.roleId));
  const ownedMax = ownedTiers.length > 0 ? Math.max(...ownedTiers.map((tier) => tier.threshold)) : -Infinity;
  if (ownedMax >= target.threshold) return null;

  const removeRoleIds = [
    ...new Set(ownedTiers.filter((tier) => tier.threshold < target.threshold).map((tier) => tier.roleId)),
  ].filter((roleId) => roleId !== target.roleId);

  return {
    discordId: candidate.discordId,
    playerName: candidate.entry.playerName,
    tag: candidate.entry.tag,
    league,
    kind,
    score: candidate.score,
    threshold: target.threshold,
    addRoleId: target.roleId,
    removeRoleIds,
  };
}

// ─── Applying ────────────────────────────────────────────────────────────────

export interface ApplyRolesResult {
  applied: number;
  failures: string[]; // human-readable lines
}

/** Applies every computed change: adds the earned role and strips outranked lower tiers. */
export async function applyAverageRoleChanges(
  guild: Guild,
  computation: AverageRolesComputation,
): Promise<ApplyRolesResult> {
  // A user can appear in both an average group and a colosseum group — merge all
  // their adds/removes so each role operation happens once.
  const perMember = new Map<string, { add: Set<string>; remove: Set<string> }>();
  const allChanges = [
    ...computation.clanGroups.flatMap((group) => group.changes),
    ...computation.colosseumGroups.flatMap((group) => group.changes),
  ];
  for (const change of allChanges) {
    let ops = perMember.get(change.discordId);
    if (!ops) {
      ops = { add: new Set(), remove: new Set() };
      perMember.set(change.discordId, ops);
    }
    ops.add.add(change.addRoleId);
    for (const roleId of change.removeRoleIds) ops.remove.add(roleId);
  }

  const result: ApplyRolesResult = { applied: 0, failures: [] };
  const reason = 'Average roles — /stats roles';

  for (const [discordId, ops] of perMember) {
    try {
      const member = await guild.members.fetch(discordId);
      for (const roleId of ops.add) {
        if (ops.remove.has(roleId)) ops.remove.delete(roleId);
        await member.roles.add(roleId, reason);
      }
      for (const roleId of ops.remove) {
        await member.roles.remove(roleId, reason);
      }
      result.applied++;
    } catch (error) {
      logger.error(`[Average Roles] Failed to update roles for user:${discordId} in guild:${guild.id}:`, error);
      result.failures.push(`<@${discordId}> — ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  return result;
}

export interface SendAnnouncementsResult {
  sent: number;
  failures: string[]; // human-readable lines
}

/** Posts the per-clan average embeds to nudge channels and colosseum embeds to their league channels. */
export async function sendAverageRoleAnnouncements(
  guild: Guild,
  computation: AverageRolesComputation,
): Promise<SendAnnouncementsResult> {
  const result: SendAnnouncementsResult = { sent: 0, failures: [] };

  const deliveries: { channelId: string | null; label: string; embed: EmbedBuilder; changes: MemberRoleChange[] }[] = [
    ...computation.clanGroups.map((group) => ({
      channelId: group.channelId,
      label: `${group.abbr} nudge channel`,
      embed: buildClanAnnouncementEmbed(group),
      changes: group.changes,
    })),
    ...computation.colosseumGroups.map((group) => ({
      channelId: group.channelId,
      label: `${group.league} colosseum channel`,
      embed: buildColosseumAnnouncementEmbed(group, computation.colosseumWeekLabel),
      changes: group.changes,
    })),
  ];

  for (const delivery of deliveries) {
    if (!delivery.channelId) continue; // already flagged in the preview notes
    try {
      const channel = await guild.channels.fetch(delivery.channelId);
      if (!channel || !channel.isTextBased()) {
        result.failures.push(`Could not send to <#${delivery.channelId}> (${delivery.label}) — not a text channel.`);
        continue;
      }

      // Mentions inside an embed never ping — the ping list has to live in the
      // message content, chunked under Discord's 2000-char content limit.
      const contentChunks = buildPingContentChunks(delivery.changes);
      await channel.send({ content: contentChunks[0], embeds: [delivery.embed] });
      for (let i = 1; i < contentChunks.length; i++) {
        await channel.send({ content: contentChunks[i] });
      }
      result.sent++;
    } catch (error) {
      logger.error(`[Average Roles] Failed to send announcement to channel:${delivery.channelId}:`, error);
      result.failures.push(`Could not send to <#${delivery.channelId}> (${delivery.label}).`);
    }
  }

  return result;
}

/**
 * Builds the "Congratulations…" ping message, one `<@user> threshold+` line per
 * change, chunked to Discord's 2000-char content limit. The greeting only
 * appears on the first chunk.
 */
function buildPingContentChunks(changes: MemberRoleChange[]): string[] {
  const greeting = 'Congratulations to the following members for earning new roles:';
  const lines = changes.map((change) => `<@${change.discordId}> ${change.threshold}+`);

  const chunks: string[] = [];
  let current = greeting;
  for (const line of lines) {
    const candidate = `${current}\n${line}`;
    if (candidate.length > 2000) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  chunks.push(current);
  return chunks;
}

// ─── Embeds ──────────────────────────────────────────────────────────────────

/**
 * Groups changes by the role they earned, highest tier first, and lists the
 * members under each role. Relies on `changes` already being sorted by score
 * descending — since role assignment is monotonic in score, the first time
 * each roleId is seen while walking that order is already highest-tier-first.
 */
function buildChangeLines(changes: MemberRoleChange[]): string[] {
  const groups = new Map<string, MemberRoleChange[]>();
  for (const change of changes) {
    const list = groups.get(change.addRoleId);
    if (list) list.push(change);
    else groups.set(change.addRoleId, [change]);
  }

  const lines: string[] = [];
  for (const [roleId, members] of groups) {
    if (lines.length > 0) lines.push('');
    lines.push(`<@&${roleId}>`);
    for (const member of members) {
      const removed =
        member.removeRoleIds.length > 0
          ? ` *(replaces ${member.removeRoleIds.map((id) => `<@&${id}>`).join(', ')})*`
          : '';
      lines.push(`<@${member.discordId}> (${member.playerName})${removed}`);
    }
  }
  return lines;
}

/** Adds lines as one or more ≤1024-char fields so long clans don't overflow Discord's field limit. */
function addLinesAsFields(embed: EmbedBuilder, name: string, lines: string[]): void {
  let chunk: string[] = [];
  let chunkLength = 0;
  let part = 0;

  const flush = () => {
    if (chunk.length === 0) return;
    embed.addFields({ name: part === 0 ? name : `${name} (cont.)`, value: chunk.join('\n') });
    part++;
    chunk = [];
    chunkLength = 0;
  };

  for (const line of lines) {
    if (chunkLength + line.length + 1 > 1024) flush();
    chunk.push(line);
    chunkLength += line.length + 1;
  }
  flush();
}

export function buildPreviewEmbeds(computation: AverageRolesComputation): EmbedBuilder[] {
  const embeds: EmbedBuilder[] = [];

  const overview = new EmbedBuilder().setTitle('Average Roles — Preview').setColor(EmbedColor.LOGS);
  const descriptionParts: string[] = [];
  if (computation.isColosseumWeek) {
    descriptionParts.push(`🏟️ Latest tracked week (**${computation.colosseumWeekLabel}**) is a **colosseum** week.`);
  }
  if (computation.totalChanges === 0) {
    descriptionParts.push('No new roles to give — everyone already holds their highest earned role.');
  }
  if (computation.notes.length > 0) {
    descriptionParts.push(computation.notes.join('\n'));
  }
  if (descriptionParts.length > 0) overview.setDescription(descriptionParts.join('\n\n'));

  for (const group of computation.clanGroups) {
    addLinesAsFields(overview, `${group.clanName}`, buildChangeLines(group.changes));
  }
  embeds.push(overview);

  if (computation.colosseumGroups.length > 0) {
    const colosseum = new EmbedBuilder()
      .setTitle(`Colosseum Roles — Preview (${computation.colosseumWeekLabel})`)
      .setColor(EmbedColor.LOGS);
    for (const group of computation.colosseumGroups) {
      addLinesAsFields(colosseum, `${group.league} Colosseum`, buildChangeLines(group.changes));
    }
    embeds.push(colosseum);
  }

  return embeds;
}

/**
 * Joins grouped change lines into a description, trimmed to Discord's 4096-char
 * embed description limit (the ping message covers the full list regardless).
 */
function buildGroupedDescription(changes: MemberRoleChange[]): string {
  const lines = buildChangeLines(changes);
  const full = lines.join('\n');
  if (full.length <= 4096) return full;

  const note = '\n\n…and more (see the full list in the ping message above).';
  let trimmed = '';
  for (const line of lines) {
    const candidate = trimmed ? `${trimmed}\n${line}` : line;
    if (candidate.length > 4096 - note.length) break;
    trimmed = candidate;
  }
  return `${trimmed}${note}`;
}

function buildClanAnnouncementEmbed(group: ClanChangeGroup): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`New Average Roles — ${group.clanName}`)
    .setColor(EmbedColor.SUCCESS)
    .setDescription(buildGroupedDescription(group.changes));
}

function buildColosseumAnnouncementEmbed(group: ColosseumChangeGroup, weekLabel: string | null): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`New ${group.league} Colosseum Roles${weekLabel ? ` — ${weekLabel}` : ''}`)
    .setColor(EmbedColor.SUCCESS)
    .setDescription(buildGroupedDescription(group.changes));
}
