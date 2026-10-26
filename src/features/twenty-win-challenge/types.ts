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
  discord_id: string;
  last_battle_time: Date | null;
}
