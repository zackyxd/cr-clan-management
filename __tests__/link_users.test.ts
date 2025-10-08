import { pool } from '../src/db.ts';
import { PoolClient } from 'pg';
import { initialize_guild } from '../src/services/guilds.ts';
import { linkUser, unlinkUser } from '../src/services/users.ts';
import { normalizeTag } from '../src/api/CR_API.ts';
import { buildUpsertRelinkPlayertag } from '../src/sql_queries/users.ts';
describe('Link users to playertags', () => {
  const guildId = '555';
  const discordId = '5318008';
  const discordId2 = '8008';
  let playertag = 'J20Y2QG0Y';
  let playertag2 = '2VJ9PL9UG';
  let faketag = 'AAAAAAA';
  let client: PoolClient;
  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  test('link one user', async () => {
    await initialize_guild(client, guildId);
    playertag = normalizeTag(playertag);
    await expectUnlinked(client, guildId, playertag);

    const result = await linkUser(client, guildId, discordId, playertag);
    expect(result.embed.data.description).toContain('Path of Legends');

    await expectLinked(client, guildId, discordId, playertag);
  });

  test('link two users', async () => {
    await initialize_guild(client, guildId);
    playertag = normalizeTag(playertag);
    await expectUnlinked(client, guildId, playertag);

    const result = await linkUser(client, guildId, discordId, playertag);
    expect(result.embed.data.description).toContain('Path of Legends');
    await expectLinked(client, guildId, discordId, playertag);

    playertag2 = normalizeTag(playertag2);
    await expectUnlinked(client, guildId, playertag2);

    const result2 = await linkUser(client, guildId, discordId2, playertag2);
    expect(result2.embed.data.description).toContain('Path of Legends');
    await expectLinked(client, guildId, discordId2, playertag2);
  });

  test('link fake account', async () => {
    await initialize_guild(client, guildId);
    faketag = normalizeTag(faketag);
    await expectUnlinked(client, guildId, faketag);

    const result = await linkUser(client, guildId, discordId, faketag);
    expect(result.embed.data.description).toContain('does not exist');
  });

  test('link account then unlink', async () => {
    await initialize_guild(client, guildId);
    playertag = normalizeTag(playertag);
    await expectUnlinked(client, guildId, playertag);

    const result = await linkUser(client, guildId, discordId, playertag);
    expect(result.embed.data.description).toContain('Path of Legends');

    await expectLinked(client, guildId, discordId, playertag);

    const result2 = await unlinkUser(client, guildId, playertag);
    expect(result2.data.description).toContain('Successfully unlinked'); // result2 is already an embed
    await expectUnlinked(client, guildId, playertag);
  });

  test('relink account', async () => {
    await initialize_guild(client, guildId);
    playertag = normalizeTag(playertag);
    await expectUnlinked(client, guildId, playertag);

    const result = await linkUser(client, guildId, discordId, playertag);
    expect(result.embed.data.description).toContain('Path of Legends');

    await expectLinked(client, guildId, discordId, playertag);

    const relink = await client.query(buildUpsertRelinkPlayertag(guildId, discordId2, playertag));
    expect(relink.rows[0].new_discord_id === discordId2);
    await expectLinked(client, guildId, discordId2, playertag);
  });
});

async function expectLinked(client: PoolClient, guildId: string, discordId: string, playertag: string) {
  const resUser = await client.query('SELECT * FROM users WHERE guild_id = $1 AND discord_id = $2', [
    guildId,
    discordId,
  ]);
  expect(resUser.rows).toHaveLength(1);

  const resTag = await client.query(
    'SELECT * FROM user_playertags WHERE guild_id = $1 AND discord_id = $2 AND playertag = $3',
    [guildId, discordId, playertag]
  );
  expect(resTag.rows).toHaveLength(1);
}

async function expectUnlinked(client: PoolClient, guildId: string, playertag: string) {
  const resTag = await client.query('SELECT * FROM user_playertags WHERE guild_id = $1 AND playertag = $2', [
    guildId,
    playertag,
  ]);
  expect(resTag.rows).toHaveLength(0);
}
