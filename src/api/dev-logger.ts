import fs from 'fs/promises';
import path from 'path';
import { isDev } from '../utils/env.js';

const LOG_ENABLED = process.env.LOG_API_RESPONSES === 'true';
const LOG_DIR = process.env.API_LOG_DIR || 'src/api/fixtures';

/**
 * Logs API responses to JSON files for debugging and testing.
 * Only active in development mode when LOG_API_RESPONSES=true.
 *
 * @param endpoint - The API endpoint name (e.g., 'getCurrentRiverRace')
 * @param identifier - The identifier (e.g., clan/player tag)
 * @param data - The API response data to log
 */
export async function logApiResponse(endpoint: string, identifier: string, data: unknown): Promise<void> {
  if (!isDev || !LOG_ENABLED) return;

  try {
    const dir = path.join(LOG_DIR, endpoint);
    await fs.mkdir(dir, { recursive: true });

    const filename = `${identifier}.json`;
    const filepath = path.join(dir, filename);

    await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');

    console.log(`[DEV] Logged API response: ${endpoint}/${filename}`);
  } catch (error) {
    console.warn('[DEV] Failed to log API response:', error);
  }
}
