import { pool } from '../../src/db.ts';
import { PoolClient } from 'pg';
import { initialize_guild } from '../../src/services/guilds.ts';
import { linkUser, unlinkUser } from '../../src/services/users.ts';
import { normalizeTag } from '../../src/api/CR_API.ts';
import { buildUpsertRelinkPlayertag } from '../../src/sql_queries/users.ts';
import { expectUnlinked, expectLinked } from '../helpers/dbAssertions.ts';
describe('Linking logic', () => {
  let client: PoolClient;
  const guildId = '555';
  const discordId = '5318008';
  const discordId2 = '8008';
  const playertag = 'J20Y2QG0Y';
  const playertag2 = '2VJ9PL9UG';
  const faketag = 'AAAAAAA';

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    await initialize_guild(client, guildId);
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  test('success linking one user', async () => {
    await linkAndExpectSuccess(client, guildId, discordId, playertag);
  });

  test('success linking two users', async () => {
    await linkAndExpectSuccess(client, guildId, discordId, playertag);
    await linkAndExpectSuccess(client, guildId, discordId2, playertag2);
  });

  test('error linking fake account', async () => {
    await expectUnlinked(client, guildId, faketag);
    await linkAndExpectFailure(client, guildId, discordId, faketag);
  });

  test('success link account then unlink', async () => {
    await expectUnlinked(client, guildId, playertag);
    await linkAndExpectSuccess(client, guildId, discordId, playertag);
    await unlinkAndExpectSuccess(client, guildId, playertag);
  });

  test('relink account', async () => {
    await expectUnlinked(client, guildId, playertag);

    // 1. Initial link
    await linkAndExpectSuccess(client, guildId, discordId, playertag);

    // 2. Relink to new discord id
    const relink = await client.query(buildUpsertRelinkPlayertag(guildId, discordId2, playertag));
    expect(relink.rows[0].new_discord_id).toBe(discordId2);
    await expectLinked(client, guildId, discordId2, playertag);
    await expectUnlinked(client, guildId, playertag, discordId);
  });
});

/**
 * Try to link valid playertag should add it to the database and expect success.
 * @param client postgres client
 * @param guildId guild id of the server
 * @param discordId discord id of the user
 * @param tag playertag to link
 */
async function linkAndExpectSuccess(client, guildId, discordId, tag) {
  const normalizedTag = normalizeTag(tag);
  await expectUnlinked(client, guildId, normalizedTag);
  const result = await linkUser(client, guildId, discordId, normalizedTag);
  expect(result.embed.data.description).toContain('Path of Legends');
  await expectLinked(client, guildId, discordId, normalizedTag);
}

/**
 * Try to link an account, but api cannot find the playertag. Should expect a failure.
 * @param client postgres client
 * @param guildId guild id of the server
 * @param discordId discord id of the user
 * @param tag playertag to link
 * @param messageSubstring substring to expect in the error message
 */
async function linkAndExpectFailure(client, guildId, discordId, tag, messageSubstring = 'does not exist') {
  const normalizedTag = normalizeTag(tag);
  const result = await linkUser(client, guildId, discordId, normalizedTag);
  expect(result.embed.data.description).toContain(messageSubstring);
  await expectUnlinked(client, guildId, normalizedTag);
}

/**
 * Unlink a playertag and ensure it's not in database.
 * @param client postgres client
 * @param guildId guild id of the server
 * @param tag playertag to unlink
 */
async function unlinkAndExpectSuccess(client, guildId, tag) {
  const normalized = normalizeTag(tag);
  const result = await unlinkUser(client, guildId, normalized);
  expect(result.data.description).toContain('Successfully unlinked'); // result2 is already an embed
  await expectUnlinked(client, guildId, normalized);
}
