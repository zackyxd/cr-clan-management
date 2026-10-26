// Battle log fields the 20 Win Challenge tracker relies on (CR_API's schema is passthrough)
export interface ChallengeCard {
  name: string;
  level: number;
  maxLevel: number;
  evolutionLevel?: number;
}

export interface ChallengeBattlePlayer {
  tag: string;
  name: string;
  crowns: number;
  startingTrophies?: number; // In the challenge this is the win count before the battle
  clan?: { tag?: string; name?: string };
  cards?: ChallengeCard[];
}

export interface ChallengeBattle {
  battleTime: string;
  gameMode: { id?: number; name: string };
  team: ChallengeBattlePlayer[];
  opponent: ChallengeBattlePlayer[];
}

export interface TrackedPlayerRow {
  playertag: string;
  // Discord user to ping when posting; null when this tag shouldn't be posted
  post_discord_id: string | null;
  // Null when the player has never been checked
  last_battle_time: Date | null;
  current_wins: number | null;
  current_losses: number | null;
  resets: number | null;
}

export interface PlayerRunState {
  wins: number;
  losses: number;
  resets: number;
  lastBattleTime: Date | null;
}
