import { PoolClient } from 'pg';

export async function seedGuilds(client: PoolClient, ids: string[]) {
  const values = ids.map((id) => `('${id}', true, NOW())`).join(',');
  await client.query(`
    INSERT INTO guilds (guild_id, in_guild, joined_at)
    VALUES ${values}
  `);
}
