# Race Tracking Scheduler Implementation Guide

## Architecture Overview

### How It Works

The `RaceTrackingScheduler` uses a **polling-based approach**:

1. **Checks every 1 minute** for tasks that need to run
2. **Queries database** for clans with active races and nudge settings
3. **Calculates scheduled times** dynamically per clan based on their settings
4. **Sends nudges/stats** when current time matches scheduled time
5. **Records in database** to prevent duplicate sends

### Key Benefits

- ✅ **Dynamic per-clan schedules** - Each clan can have different times
- ✅ **Simple architecture** - No external cron dependencies
- ✅ **Resilient** - Restarts automatically with bot
- ✅ **Database-driven** - Easy to change settings without redeploying
- ✅ **Timezone-aware** - Uses PostgreSQL timezone handling

## Database Schema

Your current schema in the `clans` table:

```javascript
race_nudge_channel_id: varchar(30); // Discord channel ID
race_nudge_start_time: time; // HH:MM:SS (e.g., "10:00:00")
race_nudge_interval_hours: integer; // Hours between nudges (default: 2)
race_nudge_count_per_day: integer; // Max nudges per day (default: 4)
race_custom_nudge_message: text; // Custom message template
eod_stats_enabled: boolean; // Auto-post end-of-day stats
```

### Example Schedule Calculation

If a clan sets:

- `start_time = "10:00:00"`
- `interval_hours = 3`
- `count_per_day = 4`

Nudges will be sent at: **10:00, 13:00, 16:00, 19:00**

## UX Recommendations

### 1. Settings Command Structure

Create a `/race-settings` command with subcommands:

```
/race-settings nudges setup
  - channel: #war-room (required)
  - start_time: "10:00" (required)
  - interval_hours: 2 (default: 2)
  - count_per_day: 4 (default: 4)

/race-settings nudges preview
  - Shows calculated schedule times

/race-settings nudges disable

/race-settings message set
  - Opens modal for custom message

/race-settings message reset
  - Back to default

/race-settings eod-stats enable
  - channel: #staff-room (required)

/race-settings eod-stats disable

/race-settings view
  - Shows all current settings
```

### 2. Time Input UX Options

#### Option A: Simple String Input (Recommended)

```typescript
// User types: "10:00" or "10:00 AM" or "22:00"
// Your code parses and validates
```

**Pros:**

- Fast to type
- Familiar format
- Works for any time

**Implementation:**

```typescript
function parseTimeInput(input: string): { hour: number; minute: number } | null {
  // Handle "10:00", "10:00 AM", "10:00:00"
  const patterns = [
    /^(\d{1,2}):(\d{2})$/, // "10:00"
    /^(\d{1,2}):(\d{2}):(\d{2})$/, // "10:00:00"
    /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i, // "10:00 AM"
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      let hour = parseInt(match[1]);
      const minute = parseInt(match[2]);
      const meridiem = match[4]?.toUpperCase();

      // Convert 12-hour to 24-hour
      if (meridiem === 'PM' && hour !== 12) hour += 12;
      if (meridiem === 'AM' && hour === 12) hour = 0;

      // Validate
      if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
        return { hour, minute };
      }
    }
  }

  return null;
}
```

#### Option B: Dropdown Menus

```typescript
// Hour dropdown: 0-23
// Minute dropdown: 00, 15, 30, 45
```

**Pros:**

- No parsing needed
- Prevents invalid input

**Cons:**

- More clicks
- Limited minute options

### 3. Visual Feedback Examples

#### Setup Confirmation Embed

```typescript
const embed = new EmbedBuilder()
  .setTitle('⚔️ Race Nudges Configured')
  .setDescription(`Automatic nudges will be sent in ${channelMention}`)
  .addFields(
    { name: 'Start Time', value: '10:00 AM', inline: true },
    { name: 'Interval', value: '2 hours', inline: true },
    { name: 'Per Day', value: '4 nudges', inline: true },
    { name: 'Schedule', value: '10:00 AM\n12:00 PM\n2:00 PM\n4:00 PM' },
  )
  .setColor(EmbedColor.SUCCESS);
```

#### Preview Command Output

```typescript
const embed = new EmbedBuilder()
  .setTitle('📅 Nudge Schedule Preview')
  .setDescription('Based on your current settings:')
  .addFields(
    { name: 'Today', value: formatSchedule(getTodaySchedule()) },
    { name: 'Next 3 Days', value: formatFutureSchedule(3) },
  );
```

### 4. Timezone Handling

**Recommendation**: Use server's timezone or per-guild timezone setting

```sql
-- Add to guild_settings or clans table
ALTER TABLE clans ADD COLUMN timezone VARCHAR(50) DEFAULT 'America/New_York';

-- When storing time
INSERT INTO clans (race_nudge_start_time)
VALUES ('10:00:00'::time AT TIME ZONE 'America/New_York');

-- When checking in scheduler
WHERE CURRENT_TIME AT TIME ZONE c.timezone
  BETWEEN c.race_nudge_start_time - INTERVAL '1 minute'
  AND c.race_nudge_start_time + INTERVAL '1 minute'
```

#### Timezone UX

```
/race-settings timezone America/New_York
/race-settings timezone list  // Show common timezones
```

### 5. Custom Message Variables

Allow users to use placeholders in custom messages:

```typescript
const DEFAULT_NUDGE_MESSAGE =
  '⚔️ Hey {clanName}! Time for attacks!\n' +
  '{playerCount} players still have attacks remaining.\n' +
  "Let's get that fame! 🏆";

// Available variables:
// {clanName} - Clan name
// {playerCount} - Number of players with attacks remaining
// {attacksRemaining} - Total attacks remaining
// {dayNumber} - Current war day (1-4)
// {playerList} - Formatted list of players
```

#### Message Setup Modal

```typescript
const modal = new ModalBuilder()
  .setCustomId('race-nudge-message')
  .setTitle('Customize Nudge Message')
  .addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('message')
        .setLabel('Message Template')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Use {clanName}, {playerCount}, etc.')
        .setValue(currentMessage)
        .setRequired(true)
        .setMaxLength(2000),
    ),
  );
```

### 6. Test Command

Add a test command for immediate validation:

```typescript
// /race-settings nudges test
// Sends a test nudge immediately to verify channel, permissions, and format
```

## Implementation Examples

### Example Command: `/race-settings nudges setup`

```typescript
import { SlashCommandBuilder, ChatInputCommandInteraction, ChannelType } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('race-settings')
  .setDescription('Configure race tracking settings')
  .addSubcommandGroup((group) =>
    group
      .setName('nudges')
      .setDescription('Configure automatic nudges')
      .addSubcommand((sub) =>
        sub
          .setName('setup')
          .setDescription('Set up automatic race nudges')
          .addChannelOption((opt) =>
            opt
              .setName('channel')
              .setDescription('Channel to send nudges')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true),
          )
          .addStringOption((opt) =>
            opt
              .setName('start_time')
              .setDescription('First nudge time (e.g., "10:00" or "10:00 AM")')
              .setRequired(true),
          )
          .addIntegerOption((opt) =>
            opt
              .setName('interval_hours')
              .setDescription('Hours between nudges')
              .setMinValue(1)
              .setMaxValue(12)
              .setRequired(false),
          )
          .addIntegerOption((opt) =>
            opt
              .setName('count_per_day')
              .setDescription('Number of nudges per day')
              .setMinValue(1)
              .setMaxValue(10)
              .setRequired(false),
          ),
      )
      .addSubcommand((sub) => sub.setName('preview').setDescription('Preview nudge schedule'))
      .addSubcommand((sub) => sub.setName('disable').setDescription('Disable automatic nudges')),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommandGroup = interaction.options.getSubcommandGroup();
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === 'nudges' && subcommand === 'setup') {
    await handleNudgeSetup(interaction);
  } else if (subcommandGroup === 'nudges' && subcommand === 'preview') {
    await handleNudgePreview(interaction);
  }
  // ... other handlers
}

async function handleNudgeSetup(interaction: ChatInputCommandInteraction) {
  const channel = interaction.options.getChannel('channel', true);
  const timeInput = interaction.options.getString('start_time', true);
  const intervalHours = interaction.options.getInteger('interval_hours') ?? 2;
  const countPerDay = interaction.options.getInteger('count_per_day') ?? 4;

  // Parse time
  const parsedTime = parseTimeInput(timeInput);
  if (!parsedTime) {
    return interaction.reply({
      content: '❌ Invalid time format. Use "10:00" or "10:00 AM"',
      ephemeral: true,
    });
  }

  // Format time for database (HH:MM:SS)
  const dbTime = `${String(parsedTime.hour).padStart(2, '0')}:${String(parsedTime.minute).padStart(2, '0')}:00`;

  // Get clan for this guild
  const clanResult = await pool.query('SELECT clantag, clan_name FROM clans WHERE guild_id = $1 LIMIT 1', [
    interaction.guildId,
  ]);

  if (clanResult.rows.length === 0) {
    return interaction.reply({
      content: '❌ No clan found. Please add a clan first.',
      ephemeral: true,
    });
  }

  const clan = clanResult.rows[0];

  // Update settings
  await pool.query(
    `
    UPDATE clans
    SET race_nudge_channel_id = $1,
        race_nudge_start_time = $2,
        race_nudge_interval_hours = $3,
        race_nudge_count_per_day = $4
    WHERE guild_id = $5 AND clantag = $6
    `,
    [channel.id, dbTime, intervalHours, countPerDay, interaction.guildId, clan.clantag],
  );

  // Calculate schedule times
  const scheduleTimes = [];
  for (let i = 0; i < countPerDay; i++) {
    const totalMinutes = parsedTime.hour * 60 + parsedTime.minute + i * intervalHours * 60;
    const hour = Math.floor(totalMinutes / 60) % 24;
    const minute = totalMinutes % 60;
    scheduleTimes.push(formatTime(hour, minute));
  }

  // Send confirmation
  const embed = new EmbedBuilder()
    .setTitle('⚔️ Race Nudges Configured')
    .setDescription(`Automatic nudges enabled for **${clan.clan_name}**`)
    .addFields(
      { name: 'Channel', value: `${channel}`, inline: true },
      { name: 'Start Time', value: formatTime(parsedTime.hour, parsedTime.minute), inline: true },
      { name: 'Interval', value: `${intervalHours} hours`, inline: true },
      { name: 'Daily Schedule', value: scheduleTimes.join('\n') },
    )
    .setColor(EmbedColor.SUCCESS)
    .setFooter({ text: 'Nudges will only be sent during war days' });

  await interaction.reply({ embeds: [embed] });
}

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}
```

## Advanced Features

### 1. Smart Nudging

Only nudge players who actually need to attack:

```typescript
// In getPlayersNeedingAttacks()
const result = await pool.query(
  `
  SELECT 
    rpt.playertag,
    rpt.player_name,
    rpt.decks_used_today,
    u.ping_user,
    up.discord_id
  FROM race_participant_tracking rpt
  LEFT JOIN user_playertags up ON rpt.playertag = up.playertag
  LEFT JOIN users u ON up.discord_id = u.discord_id
  WHERE rpt.race_id = $1
    AND rpt.decks_used_today < 4
    AND (u.ping_user IS NULL OR u.ping_user = true)  -- Respect user preferences
  ORDER BY rpt.decks_used_today ASC
  `,
  [raceId],
);
```

### 2. Nudge Escalation

Increase urgency as day progresses:

```typescript
const nudgeMessages = {
  morning: '☀️ Good morning! Time for your attacks! {playerCount} players ready to go.',
  afternoon: '⚔️ Afternoon reminder: {playerCount} players still need to attack!',
  evening: "⚠️ Evening push! Let's finish strong - {playerCount} players remaining!",
  night: '🚨 URGENT: War day ending soon! {playerCount} players - attack now!',
};
```

### 3. Pause/Resume Feature

```sql
ALTER TABLE clans ADD COLUMN race_nudges_paused BOOLEAN DEFAULT false;

-- User commands:
/race-settings nudges pause
/race-settings nudges resume
```

### 4. Per-Day Customization

```sql
-- Allow different settings per war day
ALTER TABLE clans
  ADD COLUMN race_nudge_day_1_times TEXT[],
  ADD COLUMN race_nudge_day_2_times TEXT[],
  -- etc.
```

## Monitoring & Debugging

### Add Logging

```typescript
logger.info(`[RaceNudge] Sent to ${clan.clan_name}: ${playersToNudge.length} players`);
logger.debug(`[RaceNudge] Schedule check: ${currentTime}, checking ${result.rows.length} clans`);
logger.error(`[RaceNudge] Failed for ${clan.clantag}:`, error);
```

### Admin Command for Debugging

```typescript
// /race-settings debug
// Shows next nudge time, last nudge sent, current state
```

## Performance Considerations

1. **Database indexes** - Already created in your migrations ✅
2. **Query optimization** - Use JOINs instead of multiple queries
3. **Caching** - Consider caching clan settings for 5 minutes
4. **Rate limiting** - Discord has rate limits, batch sends if needed

## Migration Path

If you need to migrate to a more sophisticated scheduler later (e.g., node-cron):

```bash
npm install node-cron
npm install @types/node-cron --save-dev
```

```typescript
import cron from 'node-cron';

// Run every minute
cron.schedule('* * * * *', () => {
  this.checkScheduledTasks();
});
```

But for your use case, the current `setInterval` approach is cleaner and more maintainable!

## Summary

✅ **Simple polling-based scheduler** - Checks every minute  
✅ **Dynamic per-clan schedules** - Database-driven  
✅ **User-friendly time input** - String parsing with validation  
✅ **Preview command** - Show schedule before enabling  
✅ **Custom messages** - Template variables for personalization  
✅ **Smart nudging** - Only ping players who need it  
✅ **Automatic EOD stats** - Configurable per clan

This architecture scales well for multiple clans with different schedules and is easy to maintain and debug.
