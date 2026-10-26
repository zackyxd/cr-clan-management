import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root (same depth from src/features/... and dist/features/...)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

// Images: overlay.png, matchIcons/crlIcon.png, cards/<card-name>[-evo].png, cards/unknown.png
export const ASSETS_DIR = path.join(REPO_ROOT, 'assets', '20wins');
export const FONT_PATH = path.join(REPO_ROOT, 'Supercell-Magic.ttf');

// Battle log eventTag of the 20 Win Challenge. gameMode.id can't be used because other challenges
// (e.g. Classic) share it. Changes between challenges, so override via env if needed.
const DEFAULT_EVENT_TAG = '#2CJUG2VL';

// Only wins that reach these values get posted
export const POST_MIN_WINS = 17;
export const MAX_WINS = 20;
// A run ends after this many losses; the next battle starts a new run (counted as a reset)
export const MAX_LOSSES = 3;

// Rough length of one challenge match, used to back off API calls
export const ROUND_MINUTES = 3;
// Players whose last challenge battle is older than this are treated as idle
export const IDLE_AFTER_MINUTES = 30;
export const IDLE_MIN_DELAY_MINUTES = 15;
// How often to refetch the full member list so role changes are picked up
export const MEMBER_REFRESH_MINUTES = 30;

export function twentyWinsMessage(discordId: string): string {
  return `Congratulations to <@${discordId}> for earning 20 wins in the 2026 20-Win Challenge <:202620wins:1564347940464754798>`;
}

export interface TwentyWinConfig {
  guildId: string;
  roleIds: string[];
  channelId: string;
  eventTag: string;
}

/** Reads config from env. Returns null (feature disabled) if anything required is missing. */
export function loadTwentyWinConfig(): TwentyWinConfig | null {
  const guildId = process.env.TWENTY_WINS_GUILD_ID?.trim();
  const channelId = process.env.TWENTY_WINS_CHANNEL_ID?.trim();
  const roleIds = (process.env.TWENTY_WINS_ROLE_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const eventTag = (process.env.TWENTY_WINS_EVENT_TAG?.trim() || DEFAULT_EVENT_TAG).toUpperCase();

  if (!guildId || !channelId || roleIds.length === 0) return null;
  return { guildId, roleIds, channelId, eventTag };
}
