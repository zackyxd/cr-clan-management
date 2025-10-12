import { EmbedBuilder } from 'discord.js';

// Simple cache with automatic cleanup
class EmbedCache {
  private cache = new Map<string, { data: Map<string, EmbedBuilder>; expiry: number }>();

  set(key: string, value: Map<string, EmbedBuilder>, ttlMs: number = 5 * 60 * 1000) {
    this.cache.set(key, {
      data: value,
      expiry: Date.now() + ttlMs,
    });
  }

  get(key: string): Map<string, EmbedBuilder> | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check if expired
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.data;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  // Optional: call this periodically to clean up expired entries
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

export const playerEmbedCache = new EmbedCache();

// Run cleanup every 2 minutes
setInterval(() => playerEmbedCache.cleanup(), 2 * 60 * 1000);
