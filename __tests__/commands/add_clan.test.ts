import { jest } from '@jest/globals';
import { PoolClient } from 'pg';
import { pool } from '../../src/db.ts';
import { resetDB } from '../helpers/dbReset';
import { linkClan } from '../../src/services/clans';
import { initialize_guild } from '../../src/services/guilds.ts';
import { CR_API } from '../../src/api/CR_API.ts';

describe('/add-clan', () => {
  let client: PoolClient;
  const guildId = '555';
  const clantag = '#V2GQU';
  const abbreviation = 'TESTCLAN';

  beforeEach(async () => {
    client = await pool.connect();
    await resetDB(client);
    await client.query('BEGIN');
    await initialize_guild(client, guildId);

    // Seed server_settings if needed
    await client.query(`INSERT INTO server_settings (guild_id, max_clans) VALUES ($1, 15)`, [guildId]);

    // Mock CR_API.getClan to always return a valid ClanResult object
    jest.spyOn(CR_API, 'getClan').mockImplementation(async (clantag: string) => ({
      name: `Clash of Clams`,
      clanWarTrophies: 1234,
      description: 'nerd',
      members: 5,
      memberList: [{ name: 'Zacky' }, { name: 'Zacky2' }],
      tag: clantag,
    }));
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
    jest.restoreAllMocks(); // Restore original implementations
  });

  test('successfully add 1 clan', async () => {
    const { embed } = await linkClan(client, guildId, clantag, abbreviation);
    expect(embed.data.description).toContain('linked to the server');

    // Check clans table
    const clanRes = await client.query('SELECT * FROM clans WHERE guild_id = $1 AND clantag = $2', [guildId, clantag]);
    expect(clanRes.rows.length).toBe(1);
    expect(clanRes.rows[0].abbreviation).toBe(abbreviation);

    // Check clan_settings table
    const settingsRes = await client.query('SELECT * FROM clan_settings WHERE guild_id = $1 AND clantag = $2', [
      guildId,
      clantag,
    ]);
    expect(settingsRes.rows.length).toBe(1);
    expect(settingsRes.rows[0].settings.abbreviation).toBe(abbreviation);
  });

  test('successfully hits default max linked clans limit', async () => {
    // set max clans to 2
    await client.query(`UPDATE server_settings SET max_clans = 2 WHERE guild_id = $1`, [guildId]);
    await linkClan(client, guildId, '#CLAN1', 'A1');
    await linkClan(client, guildId, '#CLAN2', 'A2');
    const { embed } = await linkClan(client, guildId, '#CLAN3', 'B');
    expect(embed.data.description).toContain('maximum');
  });
});
