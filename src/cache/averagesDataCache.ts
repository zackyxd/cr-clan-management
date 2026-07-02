import type { AveragesEntry } from '../features/stats/averagesLookup.js';

export interface AveragesCacheData {
  discordId: string;
  displayName: string;
  avatarURL: string;
  entries: Map<string, AveragesEntry>;
}

// Simple cache with automatic cleanup — same pattern as playerEmbedCache.
class AveragesDataCacheStore {
  private cache = new Map<string, { data: AveragesCacheData; expiry: number }>();

  set(key: string, value: AveragesCacheData, ttlMs: number = 3 * 60 * 1000) {
    this.cache.set(key, {
      data: value,
      expiry: Date.now() + ttlMs,
    });
  }

  get(key: string): AveragesCacheData | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.data;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

export const averagesDataCache = new AveragesDataCacheStore();

// Run cleanup every 2 minutes
setInterval(() => averagesDataCache.cleanup(), 2 * 60 * 1000);
