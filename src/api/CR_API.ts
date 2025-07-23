import axios, { isAxiosError } from 'axios';
import logger from '../logger.js';
import 'dotenv-flow/config';
import z from 'zod';

function normalizeTag(rawTag: string): string {
  console.log('raw:', rawTag);
  const tag = rawTag.trim().toUpperCase().replace(/O/gi, '0');
  console.log('normalized:', tag);
  return tag.startsWith('#') ? tag : `#${tag}`;
}

async function fetchData<T = unknown>(url: string): Promise<T | { error: true; statusCode: number; reason: string }> {
  try {
    const res = await axios(url, {
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

const PlayerSchema = z
  .object({
    tag: z.string(),
    name: z.string(),
  })
  .loose();

type Player = z.infer<typeof PlayerSchema>;

type FetchError = { error: true; statusCode: number; reason: string };
function isFetchError(obj: unknown): obj is FetchError {
  return (
    typeof obj === 'object' && obj !== null && 'error' in obj && (obj as Record<string, unknown>)['error'] === true
  );
}
type PlayerResult = Player | FetchError;
export async function getPlayer(playertag: string): Promise<PlayerResult> {
  playertag = normalizeTag(playertag);
  const url = `https://proxy.royaleapi.dev/v1/players/${encodeURIComponent(playertag)}`;
  const data = await fetchData(url);
  if (isFetchError(data)) {
    return data; // Error data
  }

  const parsed = PlayerSchema.safeParse(data);
  console.log(parsed);
  if (!parsed.success) {
    return {
      error: true,
      statusCode: 422,
      reason: 'Invalid player structure',
    };
  }
  return parsed.data;
}

async function main() {
  console.log(await getPlayer('    J2oY2QGoY    '));
}

main();
