import { PoolClient } from 'pg';
import logger from '../logger.js';

/**
 * Updates the username for a linked player if it has changed
 * @param client Database client
 * @param guildId Guild ID
 * @param playertag Player tag
 * @param currentUsername Current username from API
 * @returns True if username was updated, false otherwise
 */
export async function updateUsernameIfChanged(
  client: PoolClient,
  guildId: string,
  playertag: string,
  currentUsername: string,
): Promise<boolean> {
  try {
    // Get the current stored username
    const result = await client.query(
      `SELECT current_username, previous_usernames 
       FROM user_playertags 
       WHERE guild_id = $1 AND playertag = $2`,
      [guildId, playertag],
    );

    if (result.rows.length === 0) {
      // Player not linked in this guild
      return false;
    }

    const row = result.rows[0];
    const storedUsername = row.current_username;
    const previousUsernames: string[] = row.previous_usernames || [];

    // If username hasn't changed, no update needed
    if (storedUsername === currentUsername) {
      return false;
    }

    // If this is the first time storing a username (null/undefined)
    if (!storedUsername) {
      await client.query(
        `UPDATE user_playertags 
         SET current_username = $1 
         WHERE guild_id = $2 AND playertag = $3`,
        [currentUsername, guildId, playertag],
      );
      return true;
    }

    // Username has changed - add old username to history if not already there
    if (!previousUsernames.includes(storedUsername)) {
      previousUsernames.push(storedUsername);
    }

    // Update with new username and updated history
    await client.query(
      `UPDATE user_playertags 
       SET current_username = $1, previous_usernames = $2 
       WHERE guild_id = $3 AND playertag = $4`,
      [currentUsername, previousUsernames, guildId, playertag],
    );

    logger.info(`Updated username for ${playertag} in guild ${guildId}: ${storedUsername} -> ${currentUsername}`);
    return true;
  } catch (error) {
    logger.error(`Error updating username for ${playertag} in guild ${guildId}:`, error);
    return false;
  }
}

/**
 * Batch update usernames for multiple players
 * @param client Database client
 * @param guildId Guild ID
 * @param playerData Array of {playertag, username} objects
 * @returns Number of usernames updated
 */
export async function batchUpdateUsernames(
  client: PoolClient,
  guildId: string,
  playerData: Array<{ playertag: string; username: string }>,
): Promise<number> {
  let updatedCount = 0;

  for (const { playertag, username } of playerData) {
    const wasUpdated = await updateUsernameIfChanged(client, guildId, playertag, username);
    if (wasUpdated) {
      updatedCount++;
    }
  }

  return updatedCount;
}
