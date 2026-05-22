import { EmbedBuilder } from 'discord.js';
import { Player } from './CR_API.js';
import { BOTCOLOR } from '../types/EmbedUtil.js';
import { getEmoji } from '../utils/emoji.js';
type BadgeEmoji = {
  name: string;
  id: string;
  guildId: string;
};
const { default: rawBadgeData } = (await import('../utils/uploaded_badges.json', {
  with: { type: 'json' },
})) as { default: Record<string, BadgeEmoji> };

type ExpEmoji = {
  name: string;
  id: string;
  guildId: string;
};
const { default: rawExpData } = (await import('../utils/exp_icons.json', {
  with: { type: 'json' },
})) as { default: Record<string, ExpEmoji> };

export const EMOJIS = {
  polMedal: '<:polMedal:1399746349552898149>',
  clanWar: '<:clanWar:1399746432663158978>',
  classic: '<:classicChallenge:1399746536052883597>',
  grand: '<:grandChallenge:1399746504918306939>',
  level15: `<:experience_15:${rawExpData[`experience_15`].id}>`,
  level14: `<:experience_15:${rawExpData[`experience_14`].id}>`,
  level13: `<:experience_15:${rawExpData[`experience_13`].id}>`,
  evolution: `<:evolutions:1400137406031597619>`,
  cards: `<:cards:1400138265591283754>`,
  outside: `<:outside:1400303779370237963>`,
} as const;

export const LEAGUES = {
  league0: 'https://i.ibb.co/RCXnwL1/0902c20f1d9a.png',
  league1: 'https://i.ibb.co/18DnqMY/2b0de9dd5841.png',
  league2: 'https://i.ibb.co/TqVTZJY/c4c49d84427e.png',
  league3: 'https://i.ibb.co/9hSPrdw/5ef0eb18c00d.png',
  league4: 'https://i.ibb.co/h8qPv15/10a2a7bb37ec.png',
  league5: 'https://i.ibb.co/CWCWB0m/814c54494ece.png',
  league6: 'https://i.ibb.co/vDZ3kDF/a25c52c74095.png',
  league7: 'https://i.ibb.co/RCXnwL1/0902c20f1d9a.png',
} as const;

const ROLE_DISPLAY: Record<string, string> = {
  leader: '(Leader)',
  coLeader: '(Co-leader)',
  elder: '(Elder)',
  member: '(Member)',
};

let MAX_HEROES = 13;
let MAX_EVOLUTIONS = 40;

// const formattedRole = ROLE_DISPLAY[rawRole] ?? '(Unknown)';

type FullPlayer = Partial<{
  clan?: {
    name?: string;
    tag?: string;
    badgeId?: string;
  };
  expLevel: number;
  // role: string;
  currentPathOfLegendSeasonResult: {
    leagueNumber: number;
    trophies: number;
    rank: number | null;
  };
  lastPathOfLegendSeasonResult: {
    leagueNumber: number;
    trophies: number;
    rank: number | null;
  };
  bestPathOfLegendSeasonResult: {
    leagueNumber: number;
    trophies: number;
    rank: number | null;
  };
  cards: {
    name: string;
    level: number;
    rarity: string;
    evolutionLevel: number;
  }[];
}> &
  Player;

export function formatPlayerData(data: FullPlayer): EmbedBuilder | null {
  if (!data || !data.cards) return null;
  const playerName = data.name ?? 'N/A';
  const playertag = data.tag ?? 'N/A';
  const expLevel = data.expLevel ?? 1;
  const expLevelData = rawExpData[`experience_${expLevel}`];
  const expLevelIcon = expLevelData ? `<:${expLevelData.name}:${expLevelData.id}>` : `Level ${expLevel}`;
  const role = typeof data.role === 'string' ? (ROLE_DISPLAY[data.role] ?? '') : '';
  const clanName = data?.clan?.name ?? 'No Clan';
  const badgeId = data?.clan?.badgeId?.toString() ?? '00';
  const {
    currentPathOfLegendSeasonResult: { leagueNumber: currentPOLLeague, trophies: currentPOLTrophies } = {},
    lastPathOfLegendSeasonResult: { leagueNumber: lastPOLLeague, trophies: lastPOLTrophies, rank: lastPOLRank } = {},
    bestPathOfLegendSeasonResult: { leagueNumber: bestPOLLeague, trophies: bestPOLTrophies, rank: bestPOLRank } = {},
  } = data;
  type LeagueKey = keyof typeof LEAGUES;
  const key = `league${currentPOLLeague}` as LeagueKey;
  const LEAGUEIMAGE = LEAGUES[key];
  let classicWins: number = 0;
  let grandWins: number = 0;
  let clanWarWins: number = 0;

  for (const badge of data.badges) {
    switch (badge.name) {
      case 'Classic12Wins':
        classicWins = typeof badge.progress === 'number' ? badge.progress : 0;
        break;
      case 'Grand12Wins':
        grandWins = typeof badge.progress === 'number' ? badge.progress : 0;
        break;
      case 'ClanWarWins':
        clanWarWins = typeof badge.progress === 'number' ? badge.progress : 0;
        break;
    }
  }

  let level16 = 0;
  let level15 = 0;
  let level14 = 0;
  let evolutions = 0;
  let heroes = 0;

  for (const card of data.cards) {
    const checkCardLevel = checkLevel(card.level, card.rarity);
    if (checkCardLevel === 16) {
      level16++;
    }
    if (checkCardLevel === 15) {
      level15++;
    }
    if (checkCardLevel === 14) {
      level14++;
    }
    if (card?.evolutionLevel === 1) {
      evolutions++;
    }
    if (card?.evolutionLevel === 3) {
      heroes++;
      evolutions++;
    }
  }
  if (evolutions > MAX_EVOLUTIONS) MAX_EVOLUTIONS = evolutions;
  if (heroes > MAX_HEROES) MAX_HEROES = heroes;

  const badgeEmoji = getEmoji(badgeId) || '';
  const description = `${badgeEmoji} ${clanName} ${role}\n`;

  let pathOfLegendsDescription: string = '__**Ranked**__\n';
  if (currentPOLLeague || lastPOLLeague || bestPOLLeague) {
    if (currentPOLLeague === 7) {
      pathOfLegendsDescription += `Current: ${getEmoji('polMedal')} ${currentPOLTrophies}\n`;
    } else {
      pathOfLegendsDescription += `Current: ${getEmoji('polMedal')}---\n`;
    }

    if (lastPOLLeague && lastPOLLeague >= 7) {
      pathOfLegendsDescription += `Last: ${getEmoji('polMedal')} ${lastPOLTrophies} ${
        lastPOLRank ? `(#${lastPOLRank})` : ''
      }\n`;
    }

    if (bestPOLLeague && bestPOLLeague === 10) {
      pathOfLegendsDescription += `Best: ${getEmoji('polMedal')} ${bestPOLTrophies} ${
        bestPOLRank ? `(#${bestPOLRank})\n` : ''
      }`;
    }
  }

  let trophyRoadDescription: string = '__**Trophy Road**__\n';
  if (data.trophies) {
    trophyRoadDescription += `${getEmoji('trophyRoad')} ${data.trophies}\n`;
  }

  let cardLevelDescription = `__**Card Levels**__ ${getEmoji('cards')}\n`;
  cardLevelDescription += `${getEmoji('heroes')}: ${heroes}\n${getEmoji('evolutions')}: ${evolutions}\n${getEmoji('experience_16')}: ${level16}\n${getEmoji('experience_15')}: ${level15}\n${getEmoji('experience_14')}: ${level14}`;

  const combinedDescription = [description, pathOfLegendsDescription, trophyRoadDescription, cardLevelDescription].join(
    '\n',
  );
  return new EmbedBuilder()
    .setTitle(`${playerName} ${getEmoji(`experience_${expLevel}`)}`)
    .setThumbnail(LEAGUEIMAGE)
    .setURL(`https://royaleapi.com/player/${playertag.substring(1)}`)
    .setColor(BOTCOLOR)
    .addFields(
      { name: `__CW2 Wins__ ${getEmoji('clanWar')}`, value: `${clanWarWins}`, inline: true },
      { name: `__CC Wins__ ${getEmoji('classicChallenge')}`, value: `${classicWins}`, inline: true },
      { name: `__GC Wins__ ${getEmoji('grandChallenge')}`, value: `${grandWins}`, inline: true },
      {
        name: `\t`,
        value: `\u200B${getEmoji('outside')} [Ingame profile](<https://link.clashroyale.com/en/?playerInfo?id=${playertag}>)`,
        inline: false,
      },
    )
    .setDescription(combinedDescription)
    .setFooter({ text: `${playertag}` });
}

function checkLevel(level: number, rarity: string) {
  let actualLevel = 0;
  if (rarity === 'common') {
    actualLevel = level;
    return actualLevel;
  }
  if (rarity === 'rare') {
    actualLevel = level + 2;
    return actualLevel;
  }
  if (rarity === 'epic') {
    actualLevel = level + 5;
    return actualLevel;
  }
  if (rarity === 'legendary') {
    actualLevel = level + 8;
    return actualLevel;
  }
  if (rarity === 'champion') {
    actualLevel = level + 10;
    return actualLevel;
  }
}
