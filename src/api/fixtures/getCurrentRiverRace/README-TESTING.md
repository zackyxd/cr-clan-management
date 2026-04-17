# Rollover Detection Testing

## Quick Start

```bash
# Test day rollover (should detect: ✅)
/test-rollover old-fixture:test-day1.json new-fixture:test-day2-rollover.json

# Test same day (should detect: ❌)
/test-rollover old-fixture:test-day1.json new-fixture:test-day1-more-attacks.json
```

## How It Works

The `/test-rollover` command:

1. Loads two fixture files from `src/api/fixtures/getCurrentRiverRace/`
2. Passes them to `isNewWarDay()` function
3. Shows comparison and detection result

## Creating Test Fixtures

### Key Fields for Rollover Detection

```json
{
  "periodType": "warDay", // training, warDay, colosseum
  "periodIndex": 10, // Changes on day rollover
  "sectionIndex": 1, // Week number
  "clans": [
    {
      "participants": [
        {
          "decksUsed": 4, // Total for race
          "decksUsedToday": 4 // Resets on new day!
        }
      ]
    }
  ]
}
```

### Testing Scenarios

**1. Day Rollover (Day 1 → Day 2)**

- `decksUsedToday` DECREASES across all clans
- `periodIndex` typically increases by 1
- `decksUsed` continues accumulating

**2. Same Day (More Attacks)**

- `decksUsedToday` INCREASES or stays same
- `periodIndex` unchanged
- `decksUsed` increases

**3. Training → War Day**

- `periodType` changes
- `periodIndex` changes significantly
- New day should be detected

## Example Test Cases

```bash
# New day with attack reset
/test-rollover old:test-day1.json new:test-day2-rollover.json
# Expected: ✅ New Day (attacks went from 7 → 4)

# Same day, more attacks added
/test-rollover old:test-day1.json new:test-day1-more-attacks.json
# Expected: ❌ Same Day (attacks went from 7 → 10)

# Use your real clan fixtures
/test-rollover old:#V2GQU.json new:#V2GQU-updated.json
```

## Editing Your Logic

The detection function is in `service.ts`:

```typescript
function isNewWarDay(previousRaceData, newRaceData): boolean {
  // Your logic here
  // Current: Checks if total attacks decreased
  // You can add: periodIndex comparison, etc.
}
```

After editing, just run `/test-rollover` again to test your changes!

## Tips

1. **Copy existing fixtures** to test with real data:

   ```bash
   cp src/api/fixtures/getCurrentRiverRace/#V2GQU.json test-scenario1.json
   ```

2. **Edit `decksUsedToday`** to simulate rollover:
   - Decrease values = new day
   - Increase values = same day with more attacks

3. **Check `periodIndex`**:
   - Training: (periodIndex % 7) + 1
   - War Day: (periodIndex % 7) - 2

4. **Use real API data**:
   - Run `/attacks` to cache current state
   - Manually edit DB: `UPDATE river_races SET current_data = '...'`
   - Run again to test
