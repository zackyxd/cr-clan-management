interface ClanSettingsData {
  settingKey: string;
  clantag: string;
  clanName: string;
  guildId: string;
  ownerId: string;
}

class ClanSettingsCache {
  private cache = new Map<string, { data: ClanSettingsData; expiry: number }>();
  private counter = 0;
  private lastCleanup = 0;
  private cleanupInterval = 2 * 60 * 1000; // 2 minutes

  store(data: ClanSettingsData): string {
    // Lazy cleanup on store
    this.lazyCleanup();

    // Create a short, simple key
    const key = `cs_${++this.counter}`;

    this.cache.set(key, {
      data,
      expiry: Date.now() + 15 * 60 * 1000, // 15 minutes
    });

    return key;
  }

  get(key: string): ClanSettingsData | undefined {
    // Lazy cleanup on get
    this.lazyCleanup();

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

  // Only runs cleanup if enough time has passed since last cleanup
  private lazyCleanup() {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) {
      return; // Not enough time passed
    }

    this.lastCleanup = now;

    // Clean expired entries
    for (const [key, entry] of this.cache) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }

  // Get cache stats
  getStats() {
    return {
      size: this.cache.size,
      lastCleanup: new Date(this.lastCleanup),
      nextCounter: this.counter + 1,
    };
  }
}

export const clanSettingsDataCache = new ClanSettingsCache();

// Convenience function to match your existing pattern
export function storeClanSettingsData(data: ClanSettingsData): string {
  return clanSettingsDataCache.store(data);
}

export function getClanSettingsData(key: string): ClanSettingsData | undefined {
  return clanSettingsDataCache.get(key);
}
