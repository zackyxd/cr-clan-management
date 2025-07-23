import { Collection, Guild } from 'discord.js';
import pool from '../src/db.ts';
import {
  initialize_guild,
  insert_guilds_on_startup,
  remove_guild,
  remove_guilds_on_startup,
} from '../src/sql_queries/sql_guilds.ts';
import { mockGuild } from '../src/types/mockGuild.ts';

describe('Init guild', () => {
  const guildId = '555';

  beforeEach(async () => {
    await pool.query('BEGIN');
  });

  afterEach(async () => {
    await pool.query('ROLLBACK');
  });

  test('initial guilds table is empty', async () => {
    const result = await pool.query('SELECT COUNT(*) FROM guilds');
    expect(Number(result.rows[0].count)).toBe(0); // Convert to number before checking
  });

  test('should insert 1 guild', async () => {
    await initialize_guild(guildId);

    const result = await pool.query('SELECT * FROM guilds WHERE guild_id = $1', [guildId]);
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].guild_id).toBe('555');
    expect(result.rows[0].in_guild).toBe(true);
    expect(result.rows[0].left_at).toBe(null);
  });

  test('insert_guilds_on_startup inserts 2 guilds as joined', async () => {
    await pool.query(`
    INSERT INTO guilds (guild_id, in_guild, joined_at)
    VALUES 
      ('111', true, NOW()),
      ('333', true, NOW());
  `);

    const guilds = new Collection<string, Guild>();
    guilds.set('222', mockGuild('222'));
    guilds.set('444', mockGuild('444'));

    await insert_guilds_on_startup(guilds);
    let result = await pool.query('SELECT COUNT(*) FROM guilds');
    expect(Number(result.rows[0].count)).toBe(4);

    result = await pool.query(`SELECT * from guilds;`);
    const guild222 = result.rows.find((r) => r.guild_id === '222');
    const guild444 = result.rows.find((r) => r.guild_id === '444');

    expect(typeof guild222.guild_id).toBe('string');
    expect(guild222.in_guild).toBe(true);
    expect(guild222.leftAt).not.toBeNull();

    expect(typeof guild444.guild_id).toBe('string');
    expect(guild444.in_guild).toBe(true);
    expect(guild444.leftAt).not.toBeNull();
  });

  test('insert 1 guild, then remove', async () => {
    await initialize_guild(guildId);
    await remove_guild(guildId);
    const result2 = await pool.query('SELECT * FROM guilds WHERE guild_id = $1', [guildId]);
    expect(result2.rows.length).toBe(1);
    expect(result2.rows[0].guild_id).toBe('555');
    expect(result2.rows[0].in_guild).toBe(false);
    expect(result2.rows[0].left_at).toBeInstanceOf(Date); // or .not.toBeNull()
  });

  test('remove_guilds_on_start marks missing guilds as left', async () => {
    // Insert 3 guilds as if they were in DB
    await pool.query(`
    INSERT INTO guilds (guild_id, in_guild, joined_at)
    VALUES 
      ('111', true, NOW()),
      ('222', true, NOW()),
      ('333', true, NOW());
  `);

    // Simulate bot is currently only in '111' and '333'
    const guilds = new Collection<string, Guild>();
    guilds.set('111', mockGuild('111'));
    guilds.set('333', mockGuild('333'));

    // Run the function
    await remove_guilds_on_startup(guilds);

    // Check DB for results
    const result = await pool.query(`SELECT * FROM guilds ORDER BY guild_id`);

    const guild111 = result.rows.find((r) => r.guild_id === '111');
    const guild222 = result.rows.find((r) => r.guild_id === '222');
    const guild333 = result.rows.find((r) => r.guild_id === '333');

    // Still in guilds
    expect(guild111.in_guild).toBe(true);
    expect(guild111.left_at).toBeNull();

    expect(guild333.in_guild).toBe(true);
    expect(guild333.left_at).toBeNull();

    // Was removed
    expect(guild222.in_guild).toBe(false);
    expect(guild222.left_at).not.toBeNull();
    expect(guild222.left_at instanceof Date).toBe(true);
  });
});
