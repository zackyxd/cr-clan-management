# Race Progression Testing System

This system allows you to simulate race progression through multiple days, weeks, and seasons to test snapshot creation, rollover detection, and season transitions.

## Quick Start

```bash
# 1. Add a test clan to your server
/add-clan clantag:#TEST123

# 2. Run the progression test
/test-race-progression clantag:#TEST123 delay:3

# 3. Watch the bot:
#    - Detect rollovers
#    - Create snapshots
#    - Post to staff channels
#    - Handle season transitions
```

## What Gets Tested

The command simulates this progression:

1. **S131 W1 D1** (War Day 1) - Initial state
2. **S131 W1 D2** (War Day 2) - **Day rollover** (snapshot created for D1)
3. **S131 W4 D4** (Colosseum Day 4) - **Week jump** (snapshot created for W1D2)
4. **S132 Training** - **Season rollover** (snapshot created for S131 W4 D4)
5. **S132 W1 D1** (War Day 1) - **Training→War** (no snapshot for training)

## Test Scenarios Covered

### ✅ Day Rollovers
- D1 → D2: Snapshot created for day 1
- Proper `decksUsedToday` reset detection

### ✅ Week Rollovers  
- W1 → W4: New race record created
- Final snapshot created for previous week
- `end_time` set on old race

### ✅ Season Rollovers
- S131 W4 (Colosseum) → S132 Training
- Season ID detection (+1 after colosseum)
- Final snapshot for previous season

### ✅ Training Days
- Training → War Day transition
- **No snapshots created for training days**
- Proper state transitions

### ✅ Staff Channel Posts
- Rollover summaries posted automatically
- Only for War Day and Colosseum (not training)
- Shows attacks and race stats

## Fixture Files

All fixtures are in `src/api/fixtures/`:

### Current River Race (getCurrentRiverRace/)
- `s131-w1-d1.json` - Season 131, Week 1, Day 1 (War)
- `s131-w1-d2.json` - Season 131, Week 1, Day 2 (War)
- `s131-w4-d4.json` - Season 131, Week 4, Day 4 (Colosseum)
- `s132-training.json` - Season 132, Training Day
- `s132-w1-d1.json` - Season 132, Week 1, Day 1 (War)

### River Race Log (getRiverRaceLog/)
- `s131-w1-ongoing.json` - Week 1 in progress
- `s131-w4-complete.json` - Week 4 complete (Colosseum with high trophies)
- `s132-w1-ongoing.json` - New season Week 1

## Command Options

```bash
/test-race-progression 
  clantag:#YOUR_CLAN    # Required: Clan to test (must be tracked in server)
  delay:3               # Optional: Seconds between steps (default: 3)
```

## Verification Steps

After running the test:

### 1. Check Database

```sql
-- View all races created
SELECT race_id, season_id, current_week, current_day, race_state, created_at
FROM river_races
WHERE clantag = '#TEST123'
ORDER BY created_at DESC;

-- View snapshots created
SELECT rds.race_id, rds.race_day, rds.snapshot_time, rr.season_id, rr.current_week
FROM race_day_snapshots rds
JOIN river_races rr ON rds.race_id = rr.race_id
WHERE rr.clantag = '#TEST123'
ORDER BY rds.snapshot_time DESC;
```

### 2. Expected Results

| Race | Season | Week | Day | State | Snapshots |
|------|--------|------|-----|-------|-----------|
| 1    | 131    | 1    | 1   | warDay | 0 |
| 1    | 131    | 1    | 2   | warDay | 1 (day 1) |
| 2    | 131    | 4    | 4   | colosseum | 1 (W1D2) |
| 3    | 132    | 1    | -1  | training | 1 (S131W4D4) |
| 4    | 132    | 1    | 1   | warDay | 0 (no training snapshot) |

### 3. Check Staff Channel

Rollover posts should appear for:
- ✅ W1 D1 → D2 (War Day rollover)
- ✅ W1 D2 → W4 D4 (Week jump - if post logic triggers)
- ✅ S131 W4 D4 → S132 Training (if colosseum)
- ❌ Training → W1 D1 (no post for training)

## Creating Custom Fixtures

To test specific scenarios:

1. **Copy an existing fixture:**
   ```bash
   cp s131-w1-d1.json my-test-day1.json
   ```

2. **Edit key fields:**
   ```json
   {
     "periodType": "warDay",      // training, warDay, colosseum
     "periodIndex": 10,            // Unique per day
     "sectionIndex": 0,            // Week number (0-3)
     "clans": [{
       "participants": [{
         "decksUsed": 4,           // Cumulative
         "decksUsedToday": 4       // Resets each day
       }]
     }]
   }
   ```

3. **Add to sequence in command:**
   Edit `TEST_SEQUENCE` in `test-race-progression.ts`

## Troubleshooting

### No snapshots created
- Check console for `[Snapshot]` logs
- Verify `eod_stats_enabled` is true for clan
- Ensure staff channel is set

### Wrong season detection
- Check `daysSinceCreated` in log fixture (must be < 2 days for season increment)
- After colosseum week, season should increment
- Training days should be week 1 of new season

### No staff channel posts
- Verify `staff_channel_id` set for clan
- Check `eod_stats_enabled = true`
- Only posts on War/Colosseum rollovers (not training)

## Cleanup

To reset test data:

```sql
-- Delete test races and snapshots
DELETE FROM river_races WHERE clantag = '#TEST123';
-- snapshots cascade delete automatically

-- Remove test clan
DELETE FROM clans WHERE clantag = '#TEST123';
```

## Implementation Notes

### How It Works

1. **Mock API Responses**: Overrides `CR_API.getCurrentRiverRace` and `CR_API.getRiverRaceLog` temporarily
2. **Real Processing**: Calls actual `initializeOrUpdateRace()` with mocked data
3. **Real Side Effects**: Creates real snapshots, posts to real channels
4. **Restore**: Returns API functions to normal after test

### Safety

- Only affects the specified clan tag
- Other clans use real API calls
- Ephemeral messages (only you see test progress)
- Can run multiple times (snapshots upsert, not duplicate)

### Extending

To add more test scenarios:

1. Create new fixture JSON files
2. Add to `TEST_SEQUENCE` array
3. Adjust `delay` for longer observation

Example - Add Day 3:
```typescript
{
  name: 'S131 W1 D3',
  raceFile: 's131-w1-d3.json',
  logFile: 's131-w1-ongoing.json',
  description: 'Season 131, Week 1, War Day 3 (Another Day Rollover)',
}
```
