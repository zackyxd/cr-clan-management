import axios, { AxiosError, isAxiosError } from 'axios';
import logger from '../logger.js';
import 'dotenv-flow/config';
import z from 'zod';
import { EmbedBuilder } from 'discord.js';

export function normalizeTag(rawTag: string): string {
  const tag = rawTag.trim().toUpperCase().replace(/O/gi, '0').replace(/\s+/g, '');
  return tag.startsWith('#') ? tag : `#${tag}`;
}

// type FetchError = { error: true; statusCode: number; reason: string; embed: EmbedBuilder; tag: string };
// export function isFetchError(obj: unknown): obj is FetchError {
//   return (
//     typeof obj === 'object' &&
//     obj !== null &&
//     'error' in obj &&
//     'statusCode' in obj &&
//     'reason' in obj &&
//     'tag' in obj &&
//     (obj as Record<string, unknown>).error === true &&
//     typeof (obj as Record<string, unknown>).statusCode === 'number' &&
//     typeof (obj as Record<string, unknown>).reason === 'string'
//   );
// }

export type FetchError = {
  error: true;
  statusCode: number;
  reason: string;
  tag?: string;
  embed?: EmbedBuilder;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isFetchError(obj: any): obj is FetchError {
  return obj && typeof obj === 'object' && 'error' in obj;
}

async function fetchData<T = unknown>(url: string, tag = 'unknown'): Promise<T | FetchError> {
  try {
    // <-- HARD CODED TEST 503
    // return {
    //   error: true,
    //   statusCode: 503,
    //   reason: `Maintainence Break.`,
    //   tag: `x+${Math.random()}`,
    //   embed: new EmbedBuilder()
    //     .setDescription(`🚧 *It is currently Maintainence Break. Please try again later.*`)
    //     .setColor('Orange'),
    // };
    const res = await axios<T>(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.CR_KEY}`,
      },
    });
    return res.data;
  } catch (error: unknown) {
    if (isAxiosError(error)) {
      const status = error.response?.status ?? 500;

      if (status === 503) {
        logger.warn(`API error 503: Service unavailable for ${url}`);
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
        logger.info(`API error 404: Resource not found for ${url}`);
        return {
          error: true,
          statusCode: 404,
          reason: 'Resource not found',
          tag,
          embed: new EmbedBuilder().setDescription(`❌ *This playertag **${tag}** does not exist.*`).setColor('Red'),
        };
      }

      logger.error(`API error ${status} at ${url}: ${error.message}`);
      return {
        error: true,
        statusCode: status,
        reason: 'Unhandled API error',
        tag,
        embed: new EmbedBuilder().setDescription(`Unhandled Error: ${status}`).setColor('Red'),
      };
    }

    logger.error(`Unknown fetch failure at ${url}: ${String(error)}`);
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
  const url = `https://proxy.royaleapi.dev/v1/players/${encodeURIComponent(playertag)}`;
  const data = await fetchData<z.infer<typeof PlayerSchema>>(url);

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
        .setDescription('⚠️ API data format may have changed. Requires <@272201620446511104> to fix.')
        .setColor('Red'),
    };
  }

  return parsed.data;
}

export function isPlayer(p: PlayerResult): p is Player {
  return !(p as FetchError).error;
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

// const ClanSchema = z.looseObject({
//   tag: z.string(),
//   name: z.string(),
//   description: z.string(),
//   members: z.number(),
//   memberList: z.array(z.object({}).loose()),
// });
// type Clan = z.infer<typeof ClanSchema>;
// type ClanResult = Clan | FetchError;
// export async function getClan(clantag: string): Promise<ClanResult> {
//   clantag = normalizeTag(clantag);
//   const url = `https://proxy.royaleapi.dev/v1/clans/${encodeURIComponent(clantag)}`;
//   const data = await fetchData(url);
//   if (isFetchError(data)) {
//     return data; // Error data
//   }

//   const parsed = ClanSchema.safeParse(data);
//   if (!parsed.success) {
//     return {
//       error: true,
//       statusCode: 400,
//       reason: 'Invalid clan structure',
//     };
//   }
//   return parsed.data;
// }

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

// const RiverRaceParticipantSchema = z.object({
//   tag: z.string(),
//   name: z.string(),
//   fame: z.number(),
//   repairPoints: z.number(),
//   boatAttacks: z.number(),
//   decksUsed: z.number(),
//   decksUsedToday: z.number(),
// });

// const RiverRaceClanSchema = z.object({
//   tag: z.string(),
//   name: z.string(),
//   badgeId: z.number(),
//   fame: z.number(),
//   repairPoints: z.number(),
//   periodPoints: z.number().optional(), // Sometimes only present for clan
//   clanScore: z.number().optional(), // Sometimes only present for clan
//   participants: z.array(RiverRaceParticipantSchema),
// });

// const CurrentRiverRaceSchema = z.object({
//   state: z.string(),
//   clan: RiverRaceClanSchema,
//   clans: z.array(RiverRaceClanSchema),
// });

// type CurrentRiverRace = z.infer<typeof CurrentRiverRaceSchema>;
// type CurrentRiverRaceResult = CurrentRiverRace | FetchError;

// export async function getCurrentRiverRace(clantag: string): Promise<CurrentRiverRaceResult> {
//   clantag = normalizeTag(clantag);
//   const url = `https://proxy.royaleapi.dev/v1/clans/${encodeURIComponent(clantag)}/currentriverrace`;
//   const data = await fetchData(url);
//   if (isFetchError(data)) {
//     return data; // Error data
//   }

//   const parsed = CurrentRiverRaceSchema.safeParse(data);
//   if (!parsed.success) {
//     return {
//       error: true,
//       statusCode: 400,
//       reason: 'Invalid current river race structure',
//     };
//   }
//   return parsed.data;
// }

async function main() {
  // const apiTest = await getPlayer('    J2oY2QGoY    ');
  // console.log(apiTest);
  const apiTest = await getPlayer('   #P9J2d92 JCL         ');
  // console.log(apiTest);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export const CR_API = {
  getPlayer,
  // getClan,
  // getClanMembers,
  // getCurrentRiverRace,
  // getBattleLog,
  normalizeTag,
};
