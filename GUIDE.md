# Bot Feature Guide

A Discord bot for managing Clash Royale clans: it tracks River Race progress, reminds members to attack, links Discord users to their in-game accounts, onboards new members through tickets, manages clan invite links, logs clan activity, and keeps a Google Sheets stats workbook up to date.

This guide explains what each feature does and how staff use it. Times are in **UTC** — the war day ends/rolls over at **9:00 AM UTC**.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Player Links](#player-links)
3. [Race Tracking](#race-tracking)
4. [Member Channels](#member-channels)
5. [Clan Invites](#clan-invites)
6. [Tickets (Onboarding)](#tickets-onboarding)
7. [Clan Logs](#clan-logs)
8. [Stats Sheet (Google Sheets)](#stats-sheet-google-sheets)
9. [Automation Reference](#automation-reference)

---

## Getting Started

Before features work, an admin needs to set up the server:

| Command                                | What it does                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/add-clan [clantag] [abbreviation]`   | Links a clan to the server. The abbreviation (e.g. `a1`) is used everywhere — invites, settings, sheets.                              |
| `/delete-clan [clantag]`               | Removes a clan and its config.                                                                                                        |
| `/set-staff-roles [staff-type] [role]` | Maps Discord roles to the three permission tiers: **higher-leader**, **coleader**, **member**. Most staff commands require coleader+. |
| `/set-clan-role [abbreviation] [role]` | Sets the Discord role that represents a clan (used for pings and role sync).                                                          |
| `/server-settings`                     | Interactive menu to toggle features (links, tickets, clan invites, member channels) and set server-wide channels/roles.               |
| `/clan-settings [clan-abbreviation]`   | Interactive per-clan config: nudge schedule, nudge channel, custom nudge message, clan logs, and more.                                |
| `/set-clan-invite-channel [channel]`   | The channel where clan invite links live (see [Clan Invites](#clan-invites)).                                                         |
| `/set-spreadsheet-id [spreadsheet-id]` | Connects the Google Sheets stats workbook (see [Stats Sheet](#stats-sheet-google-sheets)).                                            |

---

## Player Links

Connects Discord users to their Clash Royale accounts. Links power almost everything else — nudge pings, member channels, tickets, clan logs, and the stats sheet.

- A user can have **multiple accounts** linked. Player names are cached and refreshed automatically when they change in-game.

| Command                      | Who       | What it does                                                                                                                 |
| ---------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/link [user] [playertag]`   | Coleader+ | Links an account to a user. Shows a player card; optional **Rename User** button applies the in-game name as their nickname. |
| `/unlink [user] [playertag]` | Coleader+ | Removes a link.                                                                                                              |
| `/players [user]`            | Anyone    | Shows all of a user's linked accounts (dropdown to switch between them).                                                     |
| `/find-member [playertag]`   | Anyone    | Reverse lookup — finds which Discord user owns a tag.                                                                        |

---

## Race Tracking

Live River Race tracking for every linked clan. Race data refreshes **every minute** on war/colosseum days (every 5 minutes on training days).

### Commands

| Command                                         | What it shows                                                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/race [clantag]`                               | Current race standings — fame, projections, and 🏁 for boats that have finished.                                |
| `/attacks [clantag]`                            | Who still has attacks left, grouped by decks remaining, with linked Discord names.                              |
| `/view-snapshot [abbrev] [day] [season] [week]` | Historical race data. A snapshot of each war day's final state is saved automatically at the 9 AM UTC rollover. |

Status emojis in `/attacks` and nudges:

- ☠️ Split attacker · 🚫 Do not attack (started elsewhere) · ⚠️ Replace me · ⏰ Attacking late · ❌ Left clan · 🔒 Cannot access channel

### Automatic Nudges

Each clan configures its own nudge schedule in `/clan-settings`. Two modes:

- **Interval** — starts at a set time and repeats every X hours until the war day ends at 9 AM UTC.
- **Hours before end** — fires at specific hours before 9 AM (e.g. 12h, 6h, 3h before).

Nudges post to the clan's nudge channel and ping members who still have attacks, with a per-clan custom message (resets to default each war day). Old automatic nudges are deleted when a new one posts. Nudges only run on war/colosseum days, never training days.

- `/nudge [clantag]` (staff) — sends a manual nudge immediately, with an optional custom message.
- `/ping-user [user] [preference]` (coleader+) — per-member ping preference: **Regular** (ping, but skip leaders/co-leaders), **All** (always ping), **None** (never ping).

### Attacking Late & Replace Me

Members can flag themselves for the current war day:

- `/attacking-late [message]` — Skips the first ~half of the day's nudges, then reminds as normal.
- `/replace-me [message]` — Excluded from all nudges; staff are notified so they can arrange a replacement.

Both also work by simply **@-mentioning the configured role** in a message (e.g. `@Replace Me`) — the bot reacts to confirm and posts the member's linked accounts to the staff channel (once per day per member). Both flags clear automatically at the 9 AM daily reset, and both commands toggle off if used again.

---

## Member Channels

Private channels for a group of members — typically a war lineup or a movement group for a specific clan.

### Creating: `/create-member-channel` (Coleader+)

1. A form asks for the **channel name**, **player tags**, and/or **Discord users**.
2. For users with multiple linked accounts, you pick which accounts count (specific ones, "any X accounts", or skip).
3. A confirmation summary shows the detected **clan focus** (matched from the channel name), member count, and any tags/users that couldn't be found.
4. On confirm, the channel is created in the configured category with view/send access for the listed members, and the clan's invite link is posted and pinned if one is active.

**L2W channels:** if the channel name contains `l2w`, the channel is checked against **all** clans flagged as League-to-Win instead of a single clan — member checks pool every L2W clan, and invites for all of them are sent.

### Managing: `/check` (Coleader+, inside the channel)

One command opens the management panel:

- **Check members** — shows who is ✅ in / ❌ not in the focused clan, and pings those missing.
- **Add / remove members**, **change clan focus**, **rename** (10-minute cooldown), **lock** (adds a 🔒 prefix and prevents it from being deleted).
- **Delete** — requires confirmation from multiple staff (configurable count). Before deletion, a backup of the channel (members, focus, recreation template) is posted to the logs channel.

---

## Clan Invites

Keeps one always-current invite link per clan and lets staff drop it anywhere instantly.

### Registering a link

Paste a Clash Royale invite link into the configured invite channel (or use `/update-clan-invite [invite-link]`). The bot detects the clan and expiry time from the link, updates the master invite list embed, and deletes your message. Only leaders/co-leaders can register links.

### Sending invites

- `/send-invite [tag-abbreviation]` — posts the clan's invite embed in the current channel.
- **`!abbrev` shortcut** — staff can type `!a1` (or several, like `!a1 !a2`) in any message, anywhere. The bot posts the invite(s); if the message contained only shortcuts, it's deleted to keep the channel clean.

Invite embeds show the clan's current member count, refreshed **every minute**.

### Expiry

Expiry is checked **every 10 seconds**. When a link expires, the master list is updated, every posted copy of the invite is either marked ❌ expired or deleted (per clan setting), and the clan role can optionally be pinged so someone can refresh the link.

---

## Tickets (Onboarding)

Streamlines bringing a new member in: collect their accounts, review them, link them, and welcome them.

### Flow

1. A new channel whose name matches the configured ticket pattern automatically becomes a **ticket**, and the bot posts an **Enter Playertags** button.
2. The applicant clicks it and submits their tags. Tags are validated against the game API and a player card is shown for each. The first person to submit becomes the **ticket owner**.
3. Staff review, then close the ticket — closing **auto-links every tag to the owner**, with clear results per tag (new link / conflict with another user / already linked / failed).
4. You can do `/welcome [clantag]` to give them the configured roles and send a message to where war nudges would be sent. You do not need to include the `@user` if you are doing it in a claimed ticket.

### Commands

| Command                  | What it does                                                                                                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/ticket`                | Shows the ticket's status, owner, and linked tags, with management buttons (close, add tags, resend the button).                                                                                                                                                  |
| `/welcome [clan] [user]` | (Coleader+) Welcomes a user to a clan — assigns the clan roles and posts the welcome message. Inside a ticket, `user` defaults to the ticket owner. The message includes a button; when the welcomed user clicks it, the message updates to show they've read it. |

---

## Clan Logs

Watches each clan's in-game roster and reports changes. Up to 20 clans are checked every minute.

- **Logged to the clan's log channel:** members joining, leaving, and in-game role changes (promote/demote), with the linked Discord user shown when known.
- **Role sync (optional):** automatically add the clan's Discord role when a linked player joins the clan and remove it when they leave. Can be gated behind a required base role.

Configure per clan in `/clan-settings`.

---

## Stats Sheet (Google Sheets)

Maintains a stats workbook per server (`/set-spreadsheet-id`). Tabs come in pairs per league — **5k** and **4k**:

| Tab                 | Contents                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| **Available**       | Players available to be rostered, with fame average and status checkboxes (L2W / Inactive / Remove). |
| **Averages**        | Weekly fame + attacks per player across war weeks, color-graded.                                     |
| **Lineups**         | One block per clan: roster, keep-checkboxes, current in-game clan, fame/attack average.              |
| **L2W \| Inactive** | Players marked League-to-Win or Inactive, with notes, duration, and return checkboxes.               |
| **Kicks**           | Players to kick per clan, cross-checked against the lineups.                                         |

### `/stats` subcommands

| Command                                                     | What it does                                                                                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `/stats refresh [league]`                                   | Processes all sheet checkboxes (moves players between Available / L2W / Inactive) and rebuilds the Available and L2W \| Inactive tabs. |
| `/stats update-scores`                                      | Rebuilds the Averages tabs from race history.                                                                                          |
| `/stats lineup-order [league] [clan-order] [preserve-data]` | Reorders the clan blocks on the Lineups tab. Should almost never have to be used. Do `preserve-data: true` to not overwrite the cells. |
| `/stats mark [player] [status]`                             | Marks a player L2W / Inactive / Available directly, with optional notes and a duration in days.                                        |

### Checking averages: `/average [user]`

Looks up a user's fame/attack averages straight from the Averages tabs — no need to open the sheet. Shows one line per linked account (player name, league, average fame per attack), with a dropdown to view any account's recent war weeks in detail (last 3 weeks average plus week-by-week fame/attacks). The dropdown expires after 5 minutes.

### L2W (League to Win)

Players marked L2W are parked for a set number of days (or indefinitely) and highlighted across the sheets; when the duration expires they return to Available automatically. Clans can be flagged as L2W clans, which member channels use for `l2w` lineup checks.

### Automatic upkeep

Every **5 minutes** the bot fills in the **Kicks** tab player tags from live rosters and the **Cur. Clan** column on Lineups from the latest clan snapshots. Clan block header colors are configurable per clan.

---

## Automation Reference

Everything the bot does on its own, and when:

| Automation           | Timing                                              | What it does                                                                                                                                                           |
| -------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Race data            | Every 1 min (war/colosseum), every 5 min (training) | Fetches latest race state from the CR API for all clans.                                                                                                               |
| Automatic nudges     | Checked every 1 min                                 | Sends nudges per each clan's schedule (interval or hours-before-end). War days only.                                                                                   |
| Daily reset          | @war reset                                          | War day rollover: saves the day's final snapshot, clears attacking-late / replace-me flags, resets custom nudge messages. Catches up on restart if a reset was missed. |
| Clan activity check  | 20 clans per minute                                 | Detects joins/leaves/role changes → posts clan logs, syncs Discord roles.                                                                                              |
| Invite expiry check  | Every 10 sec                                        | Marks expired invites, updates/deletes posted copies, optional role ping.                                                                                              |
| Invite member counts | Every 60 sec                                        | Refreshes member counts on posted invite embeds.                                                                                                                       |
| Kicks tag autofill   | Every 5 min                                         | Fills player tags on the Kicks sheet from live rosters.                                                                                                                |
| Cur. Clan autofill   | Every 5 min                                         | Fills the "Cur. Clan" column on Lineups from clan snapshots.                                                                                                           |
