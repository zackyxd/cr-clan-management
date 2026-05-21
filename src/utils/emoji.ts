/**
 * Emoji utility - Convenience wrapper for EmojiManager
 *
 * Provides shorter import path for accessing emojis throughout the codebase.
 *
 * Usage:
 * ```ts
 * import { getEmoji, hasEmoji } from './utils/emoji.js';
 *
 * const badge = getEmoji('clanIcon');
 * if (hasEmoji('rareEmoji')) {
 *   // ...
 * }
 * ```
 */

import { EmojiManager } from '../services/EmojiManager.js';

/**
 * Get a formatted emoji string ready for use in Discord messages.
 *
 * @param name - The emoji name (without colons or angle brackets)
 * @returns Formatted emoji string or fallback (:name:)
 */
export const getEmoji = (name: string): string => EmojiManager.get(name);

/**
 * Check if an emoji exists.
 *
 * @param name - The emoji name to check
 * @returns True if the emoji exists, false otherwise
 */
export const hasEmoji = (name: string): boolean => EmojiManager.has(name);

/**
 * Get all available emoji names.
 *
 * @returns Array of emoji names
 */
export const getAllEmojis = (): string[] => EmojiManager.getAll();

/**
 * Get the GuildEmoji object for advanced use.
 *
 * @param name - The emoji name
 * @returns GuildEmoji object or null
 */
export const getEmojiObject = (name: string) => EmojiManager.getEmoji(name);

// Re-export the EmojiManager for direct access if needed
export { EmojiManager } from '../services/EmojiManager.js';
