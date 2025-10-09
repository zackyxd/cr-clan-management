import { Collection, Guild } from 'discord.js';
import {
  initialize_guild,
  insert_guilds_on_startup,
  remove_guild,
  remove_guilds_on_startup,
} from '../../src/services/guilds.ts';
import { mockGuild } from '../../src/types/mockGuild.ts';
import { PoolClient } from 'pg';
import { pool } from '../../src/db.ts';
import { resetDB } from '../helpers/dbReset.ts';

const defaultFeatures = { tickets: false, links: true, clan_invites: true };

async function expectGuildState(client, guildId, expected) {
  const guildRes = await client.query('SELECT * FROM guilds WHERE guild_id = $1', [guildId]);
  expect(guildRes.rows.length).toBe(1);
  expect(guildRes.rows[0].in_guild).toBe(expected.in_guild);
  expect(guildRes.rows[0].left_at).toBe(expected.left_at);

  const featureRes = await client.query('SELECT * FROM guild_features WHERE guild_id = $1', [guildId]);
  for (const [feature, enabled] of Object.entries(defaultFeatures)) {
    const row = featureRes.rows.find((r) => r.feature_name === feature);
    expect(row).toBeDefined();
    expect(row.is_enabled).toBe(enabled);
  }
}

describe('Init guild', () => {
  const guildId = '555';
  let client: PoolClient;
  beforeEach(async () => {
    client = await pool.connect();
    await resetDB(client);
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  test('initial guilds table is empty', async () => {
    const result = await client.query('SELECT COUNT(*) FROM guilds');
    expect(Number(result.rows[0].count)).toBe(0);
  });

  test('should insert 1 guild', async () => {
    await initialize_guild(client, guildId);
    await expectGuildState(client, guildId, { in_guild: true, left_at: null });
  });

  test.each([
    [
      ['111', '333'],
      ['222', '444'],
    ],
  ])('insert_guilds_on_startup inserts new guilds', async (existingIds, newIds) => {
    // Seed existing guilds
    for (const id of existingIds) {
      await initialize_guild(client, id);
    }
    const guilds = new Collection<string, Guild>();
    newIds.forEach((id) => guilds.set(id, mockGuild(id)));
    await insert_guilds_on_startup(client, guilds);

    for (const id of [...existingIds, ...newIds]) {
      await expectGuildState(client, id, { in_guild: true, left_at: null });
    }
  });

  test('insert 1 guild, then remove', async () => {
    await initialize_guild(client, guildId);
    await remove_guild(client, guildId);
    const result = await client.query('SELECT * FROM guilds WHERE guild_id = $1', [guildId]);
    expect(result.rows[0].in_guild).toBe(false);
    expect(result.rows[0].left_at).not.toBeNull();
  });

  test('remove_guilds_on_start marks missing guilds as left', async () => {
    const ids = ['111', '222', '333'];
    for (const id of ids) await initialize_guild(client, id);

    const guilds = new Collection<string, Guild>();
    guilds.set('111', mockGuild('111'));
    guilds.set('333', mockGuild('333'));

    await remove_guilds_on_startup(client, guilds);

    const result = await client.query('SELECT * FROM guilds ORDER BY guild_id');
    expect(result.rows.find((r) => r.guild_id === '222').in_guild).toBe(false);
    expect(result.rows.find((r) => r.guild_id === '222').left_at).not.toBeNull();
  });
});
