import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage, registerFont, type Image } from 'canvas';
import logger from '../../logger.js';
import { ASSETS_DIR, FONT_PATH } from './config.js';
import type { ChallengeBattle, ChallengeCard } from './types.js';

const FONT_FAMILY = 'Supercell-Magic';
const TITLE = '20 Win Challenge';

try {
  registerFont(FONT_PATH, { family: FONT_FAMILY });
} catch (error) {
  logger.error(`[20Wins] Failed to register font at ${FONT_PATH}:`, error);
}

const cardsDir = path.join(ASSETS_DIR, 'cards');
const availableCards = new Set(fs.existsSync(cardsDir) ? fs.readdirSync(cardsDir) : []);

function cardFileName(card: ChallengeCard): string {
  const base = card.name.toLowerCase().replaceAll(' ', '-').replaceAll('.', '');
  const suffix = card.evolutionLevel === 1 ? '-evo' : card.evolutionLevel === 2 ? '-hero' : '';
  return `${base}${suffix}.png`;
}

async function loadCardImage(card: ChallengeCard): Promise<Image | null> {
  const fileName = availableCards.has(cardFileName(card)) ? cardFileName(card) : 'unknown.png';
  try {
    return await loadImage(path.join(cardsDir, fileName));
  } catch {
    logger.warn(`[20Wins] Missing card image for ${card.name} (${fileName})`);
    return null;
  }
}

export async function createMatchImage(battle: ChallengeBattle, wins: number): Promise<Buffer> {
  const player = battle.team[0];
  const overlay = await loadImage(path.join(ASSETS_DIR, 'overlay.png'));
  const canvas = createCanvas(overlay.width, overlay.height);
  const context = canvas.getContext('2d');
  context.drawImage(overlay, 0, 0, canvas.width, canvas.height);

  // Title + underline
  context.font = `50px ${FONT_FAMILY}`;
  context.fillStyle = 'white';
  const titleWidth = context.measureText(TITLE).width;
  const tX = (overlay.width - titleWidth) / 2;
  const tY = 90;
  context.fillText(TITLE, tX, tY);
  context.fillRect(tX, tY + 10, titleWidth, 8);

  // Match icon
  const matchIcon = await loadImage(path.join(ASSETS_DIR, 'matchIcons', 'crlIcon.png'));
  const tiX = (overlay.width - 250) / 2;
  const tiY = tY + 30;
  context.drawImage(matchIcon, tiX, tiY, 250, 250);

  // Player name
  context.font = `42px ${FONT_FAMILY}`;
  const pX = 100;
  const pY = tiY + 156;
  context.fillText(player.name, pX, pY, 480);

  // Clan
  context.font = `32px ${FONT_FAMILY}`;
  context.fillStyle = 'gray';
  const pcY = pY + 49;
  context.fillText(player.clan?.name || 'No Clan', pX, pcY, 480);
  context.fillStyle = 'white';

  // Deck (2 rows of 4)
  let cX = 100;
  let cY = pcY + 40;
  const cards = player.cards ?? [];
  for (let i = 0; i < cards.length; i++) {
    if (i === 4) {
      cX = 100;
      cY += 180;
    }

    const card = cards[i];
    const cardImg = await loadCardImage(card);
    if (cardImg) context.drawImage(cardImg, cX, cY, 125, 150);

    const lvl = String(16 - (card.maxLevel - card.level) || '?');
    context.font = `22px ${FONT_FAMILY}`;
    context.fillText(lvl, cX + (125 - context.measureText(lvl).width) / 2, cY + 173);

    cX += 156;
  }

  // Wins count on the right half
  context.font = `70px ${FONT_FAMILY}`;
  const rightMidX = (canvas.width + canvas.width / 2) / 2;
  const winsText = `${wins}`;
  const labelText = 'Wins';
  const winsY = canvas.height / 2 + 50;
  context.fillText(winsText, rightMidX - context.measureText(winsText).width / 2, winsY, 480);
  context.fillText(labelText, rightMidX - context.measureText(labelText).width / 2, winsY + 100, 480);

  return canvas.toBuffer();
}
