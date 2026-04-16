import { isAxiosError } from 'axios';
import 'dotenv-flow/config';
import z from 'zod';
import { EmbedBuilder } from 'discord.js';
import { limitedGet } from './crApiClient.js';

export function normalizeTag(rawTag: string): string {
  const tag = rawTag.trim().toUpperCase().replace(/O/gi, '0').replace(/\s+/g, '');
  if (tag.length === 0) {
    return '';
  }
  return tag.startsWith('#') ? tag : `#${tag}`;
}

export type FetchError = {
  error: true;
  statusCode: number;
  reason: string;
  tag: string;
  embed?: EmbedBuilder;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isFetchError(obj: any): obj is FetchError {
  return obj && typeof obj === 'object' && 'error' in obj;
}

export async function fetchData<T>(
  url: string,
  tag: string,
  kind: 'player' | 'clan',
  endpoint?: string,
  identifier?: string
): Promise<T | FetchError> {
  try {
    const data = await limitedGet<T>(url, endpoint, identifier);
    if (!data) {
      // fallback if Axios/Bottleneck somehow returns null/undefined
      return {
        error: true,
        statusCode: 500,
        reason: 'No data returned from API',
        tag,
        embed: new EmbedBuilder().setDescription('❌ No data returned from the API.').setColor('Red'),
      };
    }
    return data;
  } catch (error: unknown) {
    if (isAxiosError(error)) {
      const status = error.response?.status ?? 500;
      if (status === 503) {
        return {
          error: true,
          statusCode: 503,
          reason: 'Service unavailable',
          tag,
          embed: new EmbedBuilder()
            .setDescription('🚧 *The API is currently unavailable. Please try again later.*')
            .setColor('Orange'),
        };
      } else if (status === 404) {
        return {
          error: true,
          statusCode: 404,
          reason: 'Resource not found',
          tag,
          embed: new EmbedBuilder().setDescription(`❌ This ${kind} tag **${tag}** does not exist.`).setColor('Red'),
        };
      } else if (status === 403) {
        return {
          error: true,
          statusCode: 403,
          reason: 'Forbidden - Invalid or missing API key',
          tag,
          embed: new EmbedBuilder().setDescription('🔒 **API Authentication Failed**').setColor('Red'),
        };
      }

      return {
        error: true,
        statusCode: status,
        reason: `API error ${status}`,
        tag,
        embed: new EmbedBuilder().setDescription(`Unhandled API error: ${status}`).setColor('Red'),
      };
    }

    return {
      error: true,
      statusCode: 500,
      reason: 'Unknown error',
      tag,
      embed: new EmbedBuilder().setDescription('❌ Unknown error occurred while fetching data.').setColor('Red'),
    };
  }
}

const PlayerSchema = z.looseObject({
  tag: z.string(),
  name: z.string(),
  expLevel: z.number(),
  badges: z.array(z.object({}).loose()),
});

export type Player = z.infer<typeof PlayerSchema>;
export type PlayerResult = Player | FetchError;
export async function getPlayer(playertag: string): Promise<PlayerResult> {
  const normalizedTag = normalizeTag(playertag);
  const url = `players/${encodeURIComponent(normalizedTag)}`;
  const data = await fetchData<z.infer<typeof PlayerSchema>>(url, normalizedTag, 'player', 'getPlayer', normalizedTag);
  if ('error' in data) {
    return data; // already a FetchError with embed + tag
  }

  const parsed = PlayerSchema.safeParse(data);
  if (!parsed.success) {
    return {
      error: true,
      statusCode: 400,
      reason: 'Invalid player structure',
      tag: normalizedTag,
      embed: new EmbedBuilder()
        .setDescription('⚠️ API player data format may have changed. Requires <@272201620446511104> to fix.')
        .setColor('Red'),
    };
  }

  return parsed.data;
}

// const BattleSchema = z.looseObject({
//   type: z.string(),
//   battleTime: z.string(),
//   gameMode: z.object({
//     name: z.string(),
//   }),
// });

// const BattleLogSchema = z.array(BattleSchema);

// type Battle = z.infer<typeof BattleSchema>;
// type BattleResult = Battle[] | FetchError;

// export async function getBattleLog(playertag: string): Promise<BattleResult> {
//   playertag = normalizeTag(playertag);
//   const url = `https://proxy.royaleapi.dev/v1/players/${encodeURIComponent(playertag)}/battlelog`;
//   const data = await fetchData(url);
//   if (isFetchError(data)) {
//     return data; // Error data
//   }

//   const parsed = BattleLogSchema.safeParse(data);

//   if (!parsed.success) {
//     return {
//       error: true,
//       statusCode: 400,
//       reason: 'Invalid battlelog structure',
//     };
//   }

//   if (parsed.data.length === 0) {
//     return {
//       error: true,
//       statusCode: 404,
//       reason: 'No battle log found or invalid player tag',
//     };
//   }

//   return parsed.data;
// }

const ClanMemberSchema = z
  .object({
    tag: z.string(),
    name: z.string(),
  })
  .passthrough(); // Allow other properties but ensure tag and name exist

const ClanSchema = z
  .object({
    tag: z.string(),
    name: z.string(),
    description: z.string(),
    members: z.number(),
    memberList: z.array(ClanMemberSchema),
    clanWarTrophies: z.number(),
  })
  .passthrough(); // Allow other clan properties

type Clan = z.infer<typeof ClanSchema>;
type ClanResult = Clan | FetchError;
export async function getClan(clantag: string): Promise<ClanResult> {
  const normalizedTag = normalizeTag(clantag);
  const url = `https://proxy.royaleapi.dev/v1/clans/${encodeURIComponent(clantag)}`;
  const rawData = await fetchData<{ [key: string]: unknown }>(url, normalizedTag, 'clan', 'getClan', normalizedTag);

  if ('error' in rawData) {
    return rawData as FetchError; // already a FetchError with embed + tag
  }

  // Transform memberList to ensure proper typing
  if (rawData.memberList && Array.isArray(rawData.memberList)) {
    rawData.memberList = rawData.memberList
      .filter((member: unknown) => {
        const m = member as { [key: string]: unknown };
        return m?.tag && m?.name;
      })
      .map((member: unknown) => {
        const m = member as { [key: string]: unknown };
        return {
          tag: m.tag as string,
          name: m.name as string,
          ...m, // Keep any other properties
        };
      });
  }

  const parsed = ClanSchema.safeParse(rawData);
  if (!parsed.success) {
    return {
      error: true,
      statusCode: 400,
      reason: 'Invalid clan structure',
      tag: normalizedTag,
      embed: new EmbedBuilder()
        .setDescription('⚠️ API clan data format may have changed. Requires <@272201620446511104> to fix.')
        .setColor('Red'),
    };
  }
  return parsed.data;
}

// const ClanMemberEntrySchema = z
//   .object({
//     tag: z.string(),
//     name: z.string(),
//     role: z.string(),
//   })
//   .loose();

// const ClanMemberListSchema = z.object({
//   items: z.array(ClanMemberEntrySchema),
// });

// type ClanMember = z.infer<typeof ClanMemberEntrySchema>; // One member
// type ClanMemberResult = ClanMember[] | FetchError; // The array you want returned

// export async function getClanMembers(clantag: string): Promise<ClanMemberResult> {
//   clantag = normalizeTag(clantag);
//   const url = `https://proxy.royaleapi.dev/v1/clans/${encodeURIComponent(clantag)}/members`;
//   const data = await fetchData(url);
//   if (isFetchError(data)) {
//     return data; // Error data
//   }

//   const parsed = ClanMemberListSchema.safeParse(data);
//   if (!parsed.success) {
//     return {
//       error: true,
//       statusCode: 400,
//       reason: 'Invalid clan structure',
//     };
//   }
//   return parsed.data.items;
// }

const RiverRaceParticipantSchema = z.object({
  tag: z.string(),
  name: z.string(),
  fame: z.number(),
  repairPoints: z.number(),
  boatAttacks: z.number(),
  decksUsed: z.number(),
  decksUsedToday: z.number(),
});

const RiverRaceClanSchema = z.object({
  tag: z.string(),
  name: z.string(),
  badgeId: z.number(),
  fame: z.number(),
  repairPoints: z.number(),
  periodPoints: z.number().optional(), // Sometimes only present for clan
  clanScore: z.number().optional(), // Sometimes only present for clan
  participants: z.array(RiverRaceParticipantSchema),
});

const CurrentRiverRaceSchema = z.object({
  state: z.string(),
  clan: RiverRaceClanSchema,
  clans: z.array(RiverRaceClanSchema),
  sectionIndex: z.number(),
  periodIndex: z.number(),
  periodType: z.string(),
});

export type CurrentRiverRace = z.infer<typeof CurrentRiverRaceSchema>;
type CurrentRiverRaceResult = CurrentRiverRace | FetchError;

export async function getCurrentRiverRace(clantag: string): Promise<CurrentRiverRaceResult> {
  clantag = normalizeTag(clantag);
  const url = `https://proxy.royaleapi.dev/v1/clans/${encodeURIComponent(clantag)}/currentriverrace`;
  const data = await fetchData(url, clantag, 'clan', 'getCurrentRiverRace', clantag);
  if (isFetchError(data)) {
    return data; // Error data
  }

  const parsed = CurrentRiverRaceSchema.safeParse(data);
  if (!parsed.success) {
    return {
      error: true,
      statusCode: 400,
      reason: 'Invalid current river race structure',
      tag: clantag,
      embed: new EmbedBuilder()
        .setDescription(
          '⚠️ API current river race data format may have changed. Requires <@272201620446511104> to fix.',
        )
        .setColor('Red'),
    };
  }
  return parsed.data;
}

const RiverRaceLogStandingSchema = z.object({
  rank: z.number(),
  trophyChange: z.number(),
  clan: RiverRaceClanSchema, // clan is an object, not an array
});

const RiverRaceLogItemSchema = z.object({
  seasonId: z.number(),
  sectionIndex: z.number(),
  createdDate: z.string(),
  standings: z.array(RiverRaceLogStandingSchema),
});

const RiverRaceLogSchema = z.object({
  items: z.array(RiverRaceLogItemSchema),
});

type CurrentRiverRaceLogSchema = z.infer<typeof RiverRaceLogSchema>;
export type CurrentRiverRaceLogResult = CurrentRiverRaceLogSchema | FetchError;

export async function getRiverRaceLog(clantag: string): Promise<CurrentRiverRaceLogResult> {
  clantag = normalizeTag(clantag);
  const url = `https://proxy.royaleapi.dev/v1/clans/${encodeURIComponent(clantag)}/riverracelog`;
  const data = await fetchData(url, clantag, 'clan', 'getRiverRaceLog', clantag);
  if (isFetchError(data)) {
    return data; // Error data
  }

  const parsed = RiverRaceLogSchema.safeParse(data);
  if (!parsed.success) {
    return {
      error: true,
      statusCode: 400,
      reason: 'Invalid river race log structure',
      tag: clantag,
      embed: new EmbedBuilder()
        .setDescription('⚠️ API river race log data format may have changed. Requires <@272201620446511104> to fix.')
        .setColor('Red'),
    };
  }
  return parsed.data;
}

// async function main() {
//   // const apiTest = await getPlayer('    J2oY2QGoY    ');
//   // console.log(apiTest);
//   const apiTest = await getPlayer('   #P9J2d92 JCL         ');
//   // console.log(apiTest);
// }

// if (import.meta.url === `file://${process.argv[1]}`) {
//   main();
// }

export const CR_API = {
  getPlayer,
  getClan,
  // getClanMembers,
  getCurrentRiverRace,
  getRiverRaceLog,
  // getBattleLog,
  normalizeTag,
};
