import type { Client, GuildEmoji } from 'discord.js';
import logger from '../logger.js';

/**
 * EmojiManager - Centralized emoji management service
 *
 * Fetches emojis from configured Discord server(s) at bot startup.
 * Both dev and prod bots can access the same emoji servers, eliminating duplicate upload work.
 *
 * Setup:
 * 1. Create Discord server(s) for emojis (organize by category: badges, icons, etc.)
 * 2. Upload emojis to the server(s)
 * 3. Add server ID(s) to EMOJI_SERVERS array below
 * 4. Invite both dev and prod bots to the emoji server(s)
 * 5. Restart bot to load emojis
 *
 * Usage:
 * ```ts
 * import { EmojiManager } from './services/EmojiManager.js';
 *
 * // Get formatted emoji string
 * const badge = EmojiManager.get('clanIcon'); // Returns: <:clanIcon:123456>
 *
 * // Check if emoji exists
 * if (EmojiManager.has('rareEmoji')) {
 *   // ...
 * }
 *
 * // Get all available emoji names
 * const allNames = EmojiManager.getAll();
 *
 * // Get the GuildEmoji object for advanced use
 * const emojiObj = EmojiManager.getEmoji('clanIcon');
 * ```
 *
 * Updating Emojis:
 * - To replace an emoji: Rename old emoji in Discord (e.g., add '_deprec' suffix),
 *   rename new emoji to the name used in code, restart bot
 * - To add new emoji: Upload to Discord server, restart bot
 * - No code changes needed for emoji updates!
 */

/**
 * Array of Discord server (guild) IDs that contain emojis for the bot.
 * Add your emoji server IDs here.
 *
 * Example: ['1234567890123456789', '9876543210987654321']
 */
const EMOJI_SERVERS: string[] = [
  // TODO: Add your emoji server IDs here
  '1399532799953866772', // Badge ID 1
  '1399533053457731606', // Badge ID 2
  '1399543797108703292', // Badge ID 3
  '1399544049639358506', // Badge ID 4
  '1506844325387046975', // Badge ID 1 5k
  '1506844812404592764', // Badge ID 2 5k
  '1506845711306723368', // Badge ID 3 5k
  '1506845284271915049', // Badge ID 4 5k
  '1399745982261891092', // MISC emojis,
  '1507127446963748907', // EXP 1-99
  '1507127699871891529', // EXP 1-99
  '1521697664348196865', // Arena emojis
];

class EmojiManagerClass {
  private emojis: Map<string, GuildEmoji> = new Map();
  private initialized = false;

  /**
   * Initialize the emoji manager by fetching emojis from configured Discord servers.
   * This should be called once during bot startup after the client is ready.
   *
   * @param client - The Discord client instance
   * @throws Error if emoji servers are unreachable or initialization fails
   */
  async initialize(client: Client): Promise<void> {
    if (this.initialized) {
      logger.warn('EmojiManager already initialized, skipping re-initialization');
      return;
    }

    if (EMOJI_SERVERS.length === 0) {
      logger.warn('⚠️  No emoji servers configured in EmojiManager. Add server IDs to EMOJI_SERVERS array.');
      this.initialized = true;
      return;
    }

    logger.info(`🎨 Initializing EmojiManager with ${EMOJI_SERVERS.length} server(s)...`);

    let totalEmojis = 0;
    const duplicates: string[] = [];

    for (const guildId of EMOJI_SERVERS) {
      try {
        const guild = await client.guilds.fetch(guildId);

        // Fetch all emojis from the guild
        const emojis = await guild.emojis.fetch();

        logger.info(`  ├─ Fetched ${emojis.size} emoji(s) from "${guild.name}" (${guildId})`);

        // Add emojis to the map, detecting duplicates
        emojis.forEach((emoji) => {
          if (!emoji.name) return; // Skip emojis without names

          if (this.emojis.has(emoji.name)) {
            duplicates.push(emoji.name);
            logger.error(`  │  ⚠️  Duplicate emoji name detected: "${emoji.name}" (keeping first occurrence)`);
          } else {
            this.emojis.set(emoji.name, emoji);
            totalEmojis++;
          }
        });
      } catch (error) {
        logger.error(`  ├─ Failed to fetch emojis from server ${guildId}:`, error);
        throw new Error(`Failed to fetch emojis from server ${guildId}. Ensure bot has access to this server.`);
      }
    }

    this.initialized = true;

    if (duplicates.length > 0) {
      logger.warn(
        `  └─ ⚠️  Found ${duplicates.length} duplicate emoji name(s). Ensure emoji names are unique across servers.`,
      );
    }

    logger.info(`✅ EmojiManager initialized with ${totalEmojis} unique emoji(s)`);
  }

  /**
   * Get a formatted emoji string ready for use in Discord messages.
   * Returns the emoji in Discord format: <:name:id> or <a:name:id> for animated emojis.
   * If the emoji is not found, returns :name: as a graceful fallback.
   *
   * @param name - The emoji name (without colons or angle brackets)
   * @returns Formatted emoji string or fallback
   *
   * @example
   * ```ts
   * const badge = EmojiManager.get('clanIcon'); // <:clanIcon:123456789>
   * const animated = EmojiManager.get('loading'); // <a:loading:987654321>
   * const missing = EmojiManager.get('notFound'); // :notFound:
   * ```
   */
  get(name: string): string {
    const emoji = this.emojis.get(name);

    if (!emoji) {
      return `:${name}:`;
    }

    // Format: <:name:id> for static, <a:name:id> for animated
    return emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`;
  }

  /**
   * Check if an emoji exists in the manager.
   *
   * @param name - The emoji name to check
   * @returns True if the emoji exists, false otherwise
   */
  has(name: string): boolean {
    return this.emojis.has(name);
  }

  /**
   * Get all available emoji names.
   *
   * @returns Array of emoji names
   */
  getAll(): string[] {
    return Array.from(this.emojis.keys());
  }

  /**
   * Get the GuildEmoji object for advanced use cases.
   * Returns null if the emoji is not found.
   *
   * @param name - The emoji name
   * @returns GuildEmoji object or null
   */
  getEmoji(name: string): GuildEmoji | null {
    return this.emojis.get(name) || null;
  }

  /**
   * Check if the manager has been initialized.
   *
   * @returns True if initialized, false otherwise
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Export singleton instance
export const EmojiManager = new EmojiManagerClass();
