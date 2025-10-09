import { PoolClient } from 'pg';

export async function expectLinked(client: PoolClient, guildId: string, discordId: string, playertag: string) {
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

export async function expectUnlinked(client: PoolClient, guildId: string, playertag: string, discordId?: string) {
  let res;
  if (discordId) {
    res = await client.query(
      'SELECT * FROM user_playertags WHERE guild_id = $1 AND playertag = $2 AND discord_id = $3',
      [guildId, playertag, discordId]
    );
  } else {
    res = await client.query('SELECT * FROM user_playertags WHERE guild_id = $1 AND playertag = $2', [
      guildId,
      playertag,
    ]);
  }
  expect(res.rows).toHaveLength(0);
}
