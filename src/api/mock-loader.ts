import fs from 'fs/promises';
import path from 'path';
import { isDev } from '../utils/env.js';

const MOCK_ENABLED = process.env.MOCK_API_DATA === 'true';
const FIXTURE_DIR = process.env.API_LOG_DIR || 'src/api/fixtures';

/**
 * Loads mock API data from fixture files for testing.
 * Only active in development mode when MOCK_API_DATA=true.
 *
 * @param endpoint - The API endpoint name (e.g., 'getCurrentRiverRace')
 * @param identifier - The identifier (e.g., clan/player tag)
 * @returns The mock data if found and mocking is enabled, null otherwise
 */
export async function loadMockData<T>(endpoint: string, identifier: string): Promise<T | null> {
  if (!isDev || !MOCK_ENABLED) return null;

  try {
    const filepath = path.join(FIXTURE_DIR, endpoint, `${identifier}.json`);
    const content = await fs.readFile(filepath, 'utf-8');
    const data = JSON.parse(content) as T;

    console.log(`[MOCK] Loaded fixture: ${endpoint}/${identifier}.json`);
    return data;
  } catch (error) {
    console.warn(`[MOCK] No fixture found: ${endpoint}/${identifier}.json`);
    return null;
  }
}

/**
 * Check if API mocking is currently enabled.
 * @returns true if in dev mode and MOCK_API_DATA=true
 */
export function isMockingEnabled(): boolean {
  return isDev && MOCK_ENABLED;
}
