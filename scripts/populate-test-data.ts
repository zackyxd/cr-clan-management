import { pool } from '../src/db.js';
import 'dotenv-flow/config';
// Configuration
const TEST_GUILD_ID = '1395124705639534614'; // Your existing guild ID
const NUM_USERS = 4; // Number of test users to create
const MAX_PLAYERTAGS_PER_USER = 3; // Max playertags per user

// Real Discord IDs for testing (you can replace these with actual test account IDs)
const TEST_DISCORD_IDS = [
  '272201620446511104', // Your ID (you can keep this for testing)
  '1395119335512608779',
  '955088215281385492',
];

// Real playertags from various skill levels for testing
const TEST_PLAYERTAGS = ['#J20Y2QG0Y', '#P9J292JCL', '#2G0U8V2QJ', '#9YVUQCRUC'];

function getRandomDiscordId(): string {
  return TEST_DISCORD_IDS[Math.floor(Math.random() * TEST_DISCORD_IDS.length)];
}

function getRandomPlayertag(): string {
  return TEST_PLAYERTAGS[Math.floor(Math.random() * TEST_PLAYERTAGS.length)];
}

async function populateTestData() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('🚀 Starting test data population for existing guild...');

    // Note: Guild should already exist, but we'll ensure features are enabled

    // Enable features for the guild (update existing or insert new)
    const features = ['links', 'tickets', 'clan_invites', 'member_channels'];
    for (const feature of features) {
      await client.query(
        `INSERT INTO guild_features (guild_id, feature_name, is_enabled) 
         VALUES ($1, $2, true) 
         ON CONFLICT (guild_id, feature_name) DO UPDATE SET is_enabled = true`,
        [TEST_GUILD_ID, feature]
      );
    }

    // Ensure link settings exist
    await client.query(
      `INSERT INTO link_settings (guild_id, max_player_links, rename_players) 
       VALUES ($1, 5, true) 
       ON CONFLICT (guild_id) DO UPDATE SET max_player_links = 5, rename_players = true`,
      [TEST_GUILD_ID]
    );

    console.log('📊 Creating test users and playertags...');

    // Track used combinations to avoid conflicts
    const usedCombinations = new Set<string>();

    for (let i = 0; i < NUM_USERS; i++) {
      const discordId = getRandomDiscordId();
      const numPlayertags = Math.floor(Math.random() * MAX_PLAYERTAGS_PER_USER) + 1;

      console.log(`Creating user ${i + 1}/${NUM_USERS} with ${numPlayertags} playertags...`);

      // Insert user (will be ignored if already exists)
      await client.query(
        `INSERT INTO users (guild_id, discord_id, ping_user, is_replace_me, is_attacking_late, player_settings) 
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (guild_id, discord_id) DO NOTHING`,
        [
          TEST_GUILD_ID,
          discordId,
          Math.random() > 0.3, // 70% chance ping_user is true
          Math.random() > 0.8, // 20% chance is_replace_me is true
          Math.random() > 0.9, // 10% chance is_attacking_late is true
          JSON.stringify({}), // empty player_settings
        ]
      );

      // Insert playertags for this user
      for (let j = 0; j < numPlayertags; j++) {
        let playertag: string;
        let attempts = 0;

        // Try to find an unused playertag (avoid conflicts)
        do {
          playertag = getRandomPlayertag();
          attempts++;
        } while (usedCombinations.has(playertag) && attempts < 20);

        if (attempts < 20) {
          usedCombinations.add(playertag);

          await client.query(
            `INSERT INTO user_playertags (guild_id, discord_id, playertag) 
             VALUES ($1, $2, $3)
             ON CONFLICT (guild_id, playertag) DO NOTHING`,
            [TEST_GUILD_ID, discordId, playertag]
          );
        }
      }
    }

    // Create some fake clans
    console.log('🏰 Creating test clans...');
    const clanNames = ['Elite Warriors', 'Dragon Slayers', 'Royal Guards'];
    const testClanTags = ['#TESTCLAN1', '#TESTCLAN2', '#TESTCLAN3'];

    for (let i = 0; i < 3; i++) {
      const clanTag = testClanTags[i];
      const clanName = clanNames[i];

      await client.query(
        `INSERT INTO clans (guild_id, clantag, clan_name, clan_trophies, abbreviation) 
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (guild_id, clantag) DO NOTHING`,
        [TEST_GUILD_ID, clanTag, clanName, 10000, clanName.substring(0, 3).toUpperCase()]
      );

      // Create clan settings
      await client.query(
        `INSERT INTO clan_settings (guild_id, clantag) 
         VALUES ($1, $2)
         ON CONFLICT (guild_id, clantag) DO NOTHING`,
        [TEST_GUILD_ID, clanTag]
      );
    }

    await client.query('COMMIT');

    // Print summary
    const userCount = await client.query('SELECT COUNT(*) as count FROM users WHERE guild_id = $1', [TEST_GUILD_ID]);

    const playertagCount = await client.query('SELECT COUNT(*) as count FROM user_playertags WHERE guild_id = $1', [
      TEST_GUILD_ID,
    ]);

    const clanCount = await client.query('SELECT COUNT(*) as count FROM clans WHERE guild_id = $1', [TEST_GUILD_ID]);

    console.log('✅ Test data population complete!');
    console.log(`📈 Summary for Guild ${TEST_GUILD_ID}:`);
    console.log(`   - Users: ${userCount.rows[0].count}`);
    console.log(`   - Playertags: ${playertagCount.rows[0].count}`);
    console.log(`   - Clans: ${clanCount.rows[0].count}`);
    console.log(`\n💡 Note: This added test data to your existing guild.`);
    console.log(`   Real playertags may resolve to actual players when tested.`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error populating test data:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function clearTestData() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('🧹 Clearing test data from existing guild...');

    // Delete test data (keeping guild and core settings)
    await client.query('DELETE FROM user_playertags WHERE guild_id = $1', [TEST_GUILD_ID]);
    await client.query('DELETE FROM users WHERE guild_id = $1', [TEST_GUILD_ID]);
    await client.query("DELETE FROM clan_settings WHERE guild_id = $1 AND clantag LIKE '#TESTCLAN%'", [TEST_GUILD_ID]);
    await client.query("DELETE FROM clans WHERE guild_id = $1 AND clantag LIKE '#TESTCLAN%'", [TEST_GUILD_ID]);

    await client.query('COMMIT');
    console.log('✅ Test data cleared from existing guild!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error clearing test data:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--clear')) {
    await clearTestData();
  } else {
    await populateTestData();
  }

  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { populateTestData, clearTestData };
