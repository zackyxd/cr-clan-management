import axios, { AxiosError, isAxiosError } from 'axios';
import logger from '../logger.js';
import 'dotenv-flow/config';
import z from 'zod';
import { EmbedBuilder } from 'discord.js';

export function normalizeTag(rawTag: string): string {
  const tag = rawTag.trim().toUpperCase().replace(/O/gi, '0').replace(/\s+/g, '');
  return tag.startsWith('#') ? tag : `#${tag}`;
}

type FetchError = { error: true; statusCode: number; reason: string; embed: EmbedBuilder };
export function isFetchError(obj: unknown): obj is FetchError {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'error' in obj &&
    'statusCode' in obj &&
    'reason' in obj &&
    (obj as Record<string, unknown>).error === true &&
    typeof (obj as Record<string, unknown>).statusCode === 'number' &&
    typeof (obj as Record<string, unknown>).reason === 'string'
  );
}

async function fetchData<T = unknown>(url: string): Promise<T | { error: true; statusCode: number; reason: string }> {
  try {
    const res = await axios(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.CR_KEY}`,
      },
    });
    // throw new AxiosError(
    //   'Simulated 503 error',
    //   'ERR_BAD_RESPONSE',
    //   {
    //     url,
    //     method: 'GET',
    //     headers: {},
    //   },
    //   null,
    //   {
    //     status: 503,
    //     statusText: 'Service Unavailable',
    //     headers: {},
    //     config: {},
    //     data: {},
    //   }
    // );
    return res.data;
  } catch (error: unknown) {
    if (isAxiosError(error)) {
      const status = error.response?.status ?? 500;

      if (status === 503) {
        return {
          error: true,
          statusCode: 503,
          reason: 'Service unavailable',
        };
      } else if (status === 404) {
        return {
          error: true,
          statusCode: 404,
          reason: 'Resource not found',
        };
      }

      logger.error(`API error ${status}: ${error.message}`);
      return {
        error: true,
        statusCode: status,
        reason: 'Unhandled API error',
      };
    }

    logger.error(`Unknown fetch failure: ${String(error)}`);
    return {
      error: true,
      statusCode: 500,
      reason: 'Unknown error',
    };
  }
}

const PlayerSchema = z.looseObject({
  tag: z.string(),
  name: z.string(),
  badges: z.array(z.object({}).loose()),
});

export type Player = z.infer<typeof PlayerSchema>;
type PlayerResult = Player | FetchError;
export async function getPlayer(playertag: string): Promise<PlayerResult | FetchError> {
  playertag = normalizeTag(playertag);
  const url = `https://proxy.royaleapi.dev/v1/players/${encodeURIComponent(playertag)}`;
  const data = await fetchData(url);
  if (isFetchError(data)) {
    if (data.statusCode === 404) {
      return {
        error: true,
        statusCode: 404,
        reason: `Could not find player`,
        embed: new EmbedBuilder()
          .setDescription(`❌ *This playertag **${playertag}** does not exist.*`)
          .setColor('Red'),
      };
    } else if (data.statusCode === 503) {
      return {
        error: true,
        statusCode: 503,
        reason: `Maintainence Break.`,
        embed: new EmbedBuilder()
          .setDescription(`🚧 *It is currently Maintainence Break. Please try again later.*`)
          .setColor('Orange'),
      };
    } else {
      return {
        error: true,
        statusCode: data.statusCode,
        reason: `Unhandled Error`,
        embed: new EmbedBuilder()
          .setDescription(`Unhandled Error: ${data.statusCode} | ${data.reason} `)
          .setColor('Red'),
      };
    }
  }

  const parsed = PlayerSchema.safeParse(data);
  if (!parsed.success) {
    return {
      error: true,
      statusCode: 400,
      reason: 'Invalid player structure',
      embed: new EmbedBuilder()
        .setDescription(`API data format may have changed. Requires <@272201620446511104> to fix.`)
        .setColor('Red'),
    };
  }
  return parsed.data;
}

const BattleSchema = z.looseObject({
  type: z.string(),
  battleTime: z.string(),
  gameMode: z.object({
    name: z.string(),
  }),
});

const BattleLogSchema = z.array(BattleSchema);

type Battle = z.infer<typeof BattleSchema>;
type BattleResult = Battle[] | FetchError;

export async function getBattleLog(playertag: string): Promise<BattleResult> {
  playertag = normalizeTag(playertag);
  const url = `https://proxy.royaleapi.dev/v1/players/${encodeURIComponent(playertag)}/battlelog`;
  const data = await fetchData(url);
  if (isFetchError(data)) {
    return data; // Error data
  }

  const parsed = BattleLogSchema.safeParse(data);

  if (!parsed.success) {
    return {
      error: true,
      statusCode: 400,
      reason: 'Invalid battlelog structure',
    };
  }

  if (parsed.data.length === 0) {
    return {
      error: true,
      statusCode: 404,
      reason: 'No battle log found or invalid player tag',
    };
  }

  return parsed.data;
}

const ClanSchema = z.looseObject({
  tag: z.string(),
  name: z.string(),
  description: z.string(),
  members: z.number(),
  memberList: z.array(z.object({}).loose()),
});
type Clan = z.infer<typeof ClanSchema>;
type ClanResult = Clan | FetchError;
export async function getClan(clantag: string): Promise<ClanResult> {
  clantag = normalizeTag(clantag);
  const url = `https://proxy.royaleapi.dev/v1/clans/${encodeURIComponent(clantag)}`;
  const data = await fetchData(url);
  if (isFetchError(data)) {
    return data; // Error data
  }

  const parsed = ClanSchema.safeParse(data);
  if (!parsed.success) {
    return {
      error: true,
      statusCode: 400,
      reason: 'Invalid clan structure',
    };
  }
  return parsed.data;
}

const ClanMemberEntrySchema = z
  .object({
    tag: z.string(),
    name: z.string(),
    role: z.string(),
  })
  .loose();

const ClanMemberListSchema = z.object({
  items: z.array(ClanMemberEntrySchema),
});

type ClanMember = z.infer<typeof ClanMemberEntrySchema>; // One member
type ClanMemberResult = ClanMember[] | FetchError; // The array you want returned

export async function getClanMembers(clantag: string): Promise<ClanMemberResult> {
  clantag = normalizeTag(clantag);
  const url = `https://proxy.royaleapi.dev/v1/clans/${encodeURIComponent(clantag)}/members`;
  const data = await fetchData(url);
  if (isFetchError(data)) {
    return data; // Error data
  }

  const parsed = ClanMemberListSchema.safeParse(data);
  if (!parsed.success) {
    return {
      error: true,
      statusCode: 400,
      reason: 'Invalid clan structure',
    };
  }
  return parsed.data.items;
}

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
});

type CurrentRiverRace = z.infer<typeof CurrentRiverRaceSchema>;
type CurrentRiverRaceResult = CurrentRiverRace | FetchError;

export async function getCurrentRiverRace(clantag: string): Promise<CurrentRiverRaceResult> {
  clantag = normalizeTag(clantag);
  const url = `https://proxy.royaleapi.dev/v1/clans/${encodeURIComponent(clantag)}/currentriverrace`;
  const data = await fetchData(url);
  if (isFetchError(data)) {
    return data; // Error data
  }

  const parsed = CurrentRiverRaceSchema.safeParse(data);
  if (!parsed.success) {
    return {
      error: true,
      statusCode: 400,
      reason: 'Invalid current river race structure',
    };
  }
  return parsed.data;
}

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
  getClan,
  getClanMembers,
  getCurrentRiverRace,
  getBattleLog,
};
