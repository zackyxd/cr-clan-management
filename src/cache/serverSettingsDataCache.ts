export interface ServerSettingsData {
  settingKey?: string;
  featureName: string;
  tableName?: string;
  guildId: string;
  ownerId: string;
  settingType: string; // 'toggle', 'modal', 'swap', 'action', 'feature', etc.
}

class ServerSettingsCache {
  private cache = new Map<string, { data: ServerSettingsData; expiry: number }>();
  private counter = 0;
  private lastCleanup = 0;
  private cleanupInterval = 2 * 60 * 1000; // 2 minutes

  store(data: ServerSettingsData): string {
    // Lazy cleanup on store
    this.lazyCleanup();

    // Create a short, simple key
    const key = `ss_${++this.counter}`;

    this.cache.set(key, {
      data,
      expiry: Date.now() + 15 * 60 * 1000, // 15 minutes
    });

    return key;
  }

  get(key: string): ServerSettingsData | undefined {
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

export const serverSettingsDataCache = new ServerSettingsCache();

// Convenience function to match your existing pattern
export function storeServerSettingsData(data: ServerSettingsData): string {
  return serverSettingsDataCache.store(data);
}

export function getServerSettingsData(key: string): ServerSettingsData | undefined {
  return serverSettingsDataCache.get(key);
}
