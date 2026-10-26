/**
 * 20 Win Challenge Scheduler
 *
 * Every minute, checks battle logs of linked players who have one of the configured roles
 * and posts an image for each challenge win that reaches 17-20 wins.
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
  MAX_WINS,
  MEMBER_REFRESH_MINUTES,
  POST_MIN_WINS,
  ROUND_MINUTES,
  loadTwentyWinConfig,
  twentyWinsMessage,
  type TwentyWinConfig,
} from './config.js';
import { createMatchImage } from './matchImage.js';
import type { ChallengeBattle, TrackedPlayerRow } from './types.js';

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

  /** Linked playertags of members with a challenge role whose next check time has passed */
  private async getPlayersDue(config: TwentyWinConfig): Promise<TrackedPlayerRow[]> {
    const guild = this.client.guilds.cache.get(config.guildId);
    if (!guild) {
      logger.warn(`[20Wins] Guild ${config.guildId} not found`);
      return [];
    }

    // Member cache is kept up to date by the GuildMembers intent; refetch occasionally to be safe
    if (Date.now() - this.lastMemberFetch > MEMBER_REFRESH_MINUTES * 60 * 1000) {
      await guild.members.fetch();
      this.lastMemberFetch = Date.now();
    }

    const discordIds = new Set<string>();
    for (const roleId of config.roleIds) {
      guild.roles.cache.get(roleId)?.members.forEach((member) => discordIds.add(member.id));
    }
    if (discordIds.size === 0) return [];

    const res = await pool.query<TrackedPlayerRow>(
      `
      SELECT up.playertag, up.discord_id, s.last_battle_time
      FROM user_playertags up
      LEFT JOIN twenty_win_challenge_players s ON s.playertag = up.playertag
      WHERE up.guild_id = $1
        AND up.discord_id = ANY($2)
        AND (s.next_check_at IS NULL OR s.next_check_at <= NOW())
        AND COALESCE(s.current_wins, 0) < $3 -- accounts that hit 20 are done for good
      `,
      [config.guildId, [...discordIds], MAX_WINS],
    );
    return res.rows;
  }

  private async checkPlayer(config: TwentyWinConfig, player: TrackedPlayerRow) {
    try {
      const log = await getBattleLog(player.playertag);
      if (isFetchError(log)) {
        // Bad tag: back off for a while. Other errors: retry next tick.
        if (log.statusCode === 404) await this.saveState(player.playertag, 0, player.last_battle_time, 60);
        return;
      }

      // Battle log is newest first
      const challengeBattles = (log as unknown as ChallengeBattle[]).filter(
        (b) => b.gameMode?.id === config.gameModeId && b.team?.[0] && b.opponent?.[0],
      );

      const latest = challengeBattles[0];
      const latestTime = latest ? parseBattleTime(latest.battleTime) : player.last_battle_time;
      let currentWins = latest ? winsAfter(latest) : 0;

      const newBattles = challengeBattles
        .filter((b) => !player.last_battle_time || parseBattleTime(b.battleTime) > player.last_battle_time)
        .reverse(); // oldest first so posts are in order

      for (const battle of newBattles) {
        const wins = winsAfter(battle);
        if (isWin(battle) && wins >= POST_MIN_WINS && wins <= MAX_WINS) {
          await this.postWin(config, player.discord_id, battle, wins);
        }
        // 20 wins is once per account: lock it in and ignore anything after
        if (wins >= MAX_WINS) {
          currentWins = MAX_WINS;
          break;
        }
      }

      await this.saveState(player.playertag, currentWins, latestTime, nextCheckDelayMinutes(currentWins, latestTime));
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

  private async saveState(playertag: string, wins: number, lastBattleTime: Date | null, delayMinutes: number) {
    await pool.query(
      `
      INSERT INTO twenty_win_challenge_players (playertag, current_wins, last_battle_time, next_check_at, updated_at)
      VALUES ($1, $2, $3, NOW() + make_interval(mins => $4), NOW())
      ON CONFLICT (playertag) DO UPDATE SET
        current_wins = EXCLUDED.current_wins,
        last_battle_time = EXCLUDED.last_battle_time,
        next_check_at = EXCLUDED.next_check_at,
        updated_at = NOW()
      `,
      [playertag, wins, lastBattleTime, delayMinutes],
    );
  }
}
