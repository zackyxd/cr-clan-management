import { PoolClient } from 'pg';

export async function resetDB(client: PoolClient) {
  await client.query(`
    TRUNCATE TABLE guilds, guild_features, clan_settings RESTART IDENTITY CASCADE;
  `);
}
