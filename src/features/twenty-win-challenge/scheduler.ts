/**
 * 20 Win Challenge Scheduler
 *
 * Every minute, checks battle logs of all linked players (tracking wins, losses and resets),
 * and posts an image for each challenge win that reaches 17-20 wins, but only for players
 * linked in the configured server who have one of the configured roles.
 *
 * To save API calls, a player below 17 wins isn't checked again until they could plausibly
 * be close: (17 - wins - 1) rounds * ~3 minutes. e.g. 1 win -> 15 rounds -> 45 minutes.
 */

import { AttachmentBuilder, Client } from 'discord.js';
import { pool } from '../../db.js';
import logger from '../../logger.js';
import { getBattleLog, isFetchError } from '../../api/CR_API.js';
import {
  IDLE_AFTER_MINUTES,
  IDLE_MIN_DELAY_MINUTES,
  MAX_LOSSES,
  MAX_WINS,
  MEMBER_REFRESH_MINUTES,
  POST_MIN_WINS,
  ROUND_MINUTES,
  loadTwentyWinConfig,
  twentyWinsMessage,
  type TwentyWinConfig,
} from './config.js';
import { createMatchImage } from './matchImage.js';
import type { ChallengeBattle, PlayerRunState, TrackedPlayerRow } from './types.js';

const TICK_MS = 60 * 1000;

/** Battle times look like 20251026T143000.000Z */
function parseBattleTime(battleTime: string): Date {
  const m = battleTime.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!m) return new Date(battleTime);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

function isWin(battle: ChallengeBattle): boolean {
  return battle.team[0].crowns > battle.opponent[0].crowns;
}

/** Win count after this battle (startingTrophies holds the win count going into it) */
function winsAfter(battle: ChallengeBattle): number {
  const before = battle.team[0].startingTrophies ?? 0;
  return isWin(battle) ? before + 1 : before;
}

/** Minutes until this player's battle log is worth fetching again */
export function nextCheckDelayMinutes(wins: number, lastBattleAt: Date | null, now = Date.now()): number {
  // Rounds until they could reach the first posted milestone, with a 1 round buffer
  const rounds = Math.max(1, POST_MIN_WINS - wins - 1);
  let delay = rounds * ROUND_MINUTES;

  const idle = !lastBattleAt || now - lastBattleAt.getTime() > IDLE_AFTER_MINUTES * 60 * 1000;
  if (idle) delay = Math.max(delay, IDLE_MIN_DELAY_MINUTES);
  return delay;
}

export class TwentyWinChallengeScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastMemberFetch = 0;
  private config: TwentyWinConfig | null = null;

  constructor(private client: Client) {}

  start() {
    if (this.intervalId) return;

    this.config = loadTwentyWinConfig();
    if (!this.config) {
      logger.info('[20Wins] TWENTY_WINS_* env vars not set; 20 win challenge tracker disabled');
      return;
    }

    logger.info(`[20Wins] Starting 20 win challenge scheduler for roles ${this.config.roleIds.join(', ')}`);
    this.intervalId = setInterval(() => void this.runCycle(), TICK_MS);
    void this.runCycle();
  }

  stop() {
    if (!this.intervalId) return;
    clearInterval(this.intervalId);
    this.intervalId = null;
  }

  private async runCycle() {
    if (this.isRunning || !this.config) return;
    this.isRunning = true;

    try {
      const players = await this.getPlayersDue(this.config);
      if (players.length === 0) return;

      logger.info(`[20Wins] Checking ${players.length} players`);
      await Promise.all(players.map((player) => this.checkPlayer(this.config!, player)));
    } catch (error) {
      logger.error('[20Wins] Cycle failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Every linked playertag (across all servers) whose next check time has passed.
   * post_discord_id is only set when the tag is linked in the configured server to a member
   * with a challenge role; everyone else is tracked but never posted.
   */
  private async getPlayersDue(config: TwentyWinConfig): Promise<TrackedPlayerRow[]> {
    const discordIds = new Set<string>();
    const guild = this.client.guilds.cache.get(config.guildId);
    if (guild) {
      // Member cache is kept up to date by the GuildMembers intent; refetch occasionally to be safe
      if (Date.now() - this.lastMemberFetch > MEMBER_REFRESH_MINUTES * 60 * 1000) {
        await guild.members.fetch();
        this.lastMemberFetch = Date.now();
      }
      for (const roleId of config.roleIds) {
        guild.roles.cache.get(roleId)?.members.forEach((member) => discordIds.add(member.id));
      }
    } else {
      logger.warn(`[20Wins] Guild ${config.guildId} not found; tracking without posting`);
    }

    const res = await pool.query<TrackedPlayerRow>(
      `
      SELECT
        up.playertag,
        MAX(up.discord_id) FILTER (WHERE up.guild_id = $1 AND up.discord_id = ANY($2)) AS post_discord_id,
        s.last_battle_time, s.current_wins, s.current_losses, s.resets, s.max_wins
      FROM user_playertags up
      LEFT JOIN twenty_win_challenge_players s ON s.playertag = up.playertag
      WHERE (s.next_check_at IS NULL OR s.next_check_at <= NOW())
        AND COALESCE(s.current_wins, 0) < $3 -- accounts that hit 20 are done for good
      GROUP BY up.playertag, s.last_battle_time, s.current_wins, s.current_losses, s.resets, s.max_wins
      `,
      [config.guildId, [...discordIds], MAX_WINS],
    );
    return res.rows;
  }

  private async checkPlayer(config: TwentyWinConfig, player: TrackedPlayerRow) {
    try {
      const state: PlayerRunState = {
        wins: player.current_wins ?? 0,
        losses: player.current_losses ?? 0,
        resets: player.resets ?? 0,
        maxWins: player.max_wins ?? 0,
        lastBattleTime: player.last_battle_time,
      };

      const log = await getBattleLog(player.playertag);
      if (isFetchError(log)) {
        // Bad tag: back off for a while. Other errors: retry next tick.
        if (log.statusCode === 404) await this.saveState(player.playertag, state, 60);
        return;
      }

      // Battle log is newest first
      const challengeBattles = (log as unknown as ChallengeBattle[]).filter(
        (b) => b.eventTag?.toUpperCase() === config.eventTag && b.team?.[0] && b.opponent?.[0],
      );

      const newBattles = challengeBattles
        .filter((b) => !player.last_battle_time || parseBattleTime(b.battleTime) > player.last_battle_time)
        .reverse(); // oldest first so posts and resets are in order

      // Without a saved row there's no previous battle to compare the first one against
      let hasPrevious = player.current_wins !== null;
      for (const battle of newBattles) {
        const winsBefore = battle.team[0].startingTrophies ?? 0;
        if (hasPrevious && (winsBefore < state.wins || state.losses >= MAX_LOSSES)) {
          state.resets++;
          state.losses = 0;
        }
        hasPrevious = true;

        const wins = winsAfter(battle);
        state.wins = wins;
        state.maxWins = Math.max(state.maxWins, Math.min(wins, MAX_WINS));
        state.lastBattleTime = parseBattleTime(battle.battleTime);
        if (!isWin(battle)) state.losses++;

        if (player.post_discord_id && isWin(battle) && wins >= POST_MIN_WINS && wins <= MAX_WINS) {
          await this.postWin(config, player.post_discord_id, battle, wins);
        }
        // 20 wins is once per account: lock it in and ignore anything after
        if (wins >= MAX_WINS) {
          state.wins = MAX_WINS;
          break;
        }
      }

      await this.saveState(player.playertag, state, nextCheckDelayMinutes(state.wins, state.lastBattleTime));
    } catch (error) {
      logger.error(`[20Wins] Failed checking ${player.playertag}:`, error);
    }
  }

  private async postWin(config: TwentyWinConfig, discordId: string, battle: ChallengeBattle, wins: number) {
    try {
      const channel = await this.client.channels.fetch(config.channelId);
      if (!channel?.isSendable()) {
        logger.warn(`[20Wins] Channel ${config.channelId} not found or not sendable`);
        return;
      }

      const buffer = await createMatchImage(battle, wins);
      const attachment = new AttachmentBuilder(buffer, { name: 'match.png' });
      await channel.send({
        content: wins === MAX_WINS ? twentyWinsMessage(discordId) : undefined,
        files: [attachment],
      });
      logger.info(`[20Wins] Posted ${wins} wins for ${battle.team[0].tag}`);
    } catch (error) {
      logger.error(`[20Wins] Failed posting ${wins} wins for ${battle.team[0].tag}:`, error);
    }
  }

  private async saveState(playertag: string, state: PlayerRunState, delayMinutes: number) {
    await pool.query(
      `
      INSERT INTO twenty_win_challenge_players
        (playertag, current_wins, current_losses, resets, max_wins, last_battle_time, next_check_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW() + make_interval(mins => $7), NOW())
      ON CONFLICT (playertag) DO UPDATE SET
        current_wins = EXCLUDED.current_wins,
        current_losses = EXCLUDED.current_losses,
        resets = EXCLUDED.resets,
        max_wins = GREATEST(twenty_win_challenge_players.max_wins, EXCLUDED.max_wins),
        last_battle_time = EXCLUDED.last_battle_time,
        next_check_at = EXCLUDED.next_check_at,
        updated_at = NOW()
      `,
      [playertag, state.wins, state.losses, state.resets, state.maxWins, state.lastBattleTime, delayMinutes],
    );
  }
}
