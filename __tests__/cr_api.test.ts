import { CR_API, normalizeTag } from '../src/api/CR_API.ts';

describe('normalize tags', () => {
  const normalized = '#P9J292JCL';

  test.each(['p9 j2 92 jcl', ' #p9j292jcl', '#P9J292JCL ', ' #P9J2 92JCL ', ' P9J2 92JCL '])(
    'normalizes "%s to "#P9J292JCL"',
    (input) => {
      expect(normalizeTag(input)).toBe(normalized);
    }
  );
});

describe('call cr_api', () => {
  const valid_playertag = 'P9J292JCL';
  const invalid_playertag = 'P9J2492JCL';
  const valid_clantag = '9U82JJ0Y';
  const invalid_clantag = '9U824JJ0Y';

  // getPlayer
  test('getPlayer API request error', async () => {
    const res = await CR_API.getPlayer(invalid_playertag);
    expect(res).toHaveProperty('error', true);
  });

  test('getPlayer API request success', async () => {
    const res = await CR_API.getPlayer(valid_playertag);
    expect(res).toHaveProperty('tag');
    expect(res).toHaveProperty('name');
    expect(res).toHaveProperty('expLevel');
    expect(res).toHaveProperty('badges');
  });

  // getBattleLog
  // test('getBattleLog API request error', async () => {
  //   const res = await CR_API.getBattleLog(invalid_playertag);
  //   expect(res).toHaveProperty('error');
  // });

  // test('getBattleLog API request success', async () => {
  //   const res = await CR_API.getBattleLog(valid_playertag);
  //   expect(res).toBeInstanceOf(Array);
  // });

  // // getClan
  // test('getClan API request error', async () => {
  //   const res = await CR_API.getClan(invalid_clantag);
  //   expect(res).toHaveProperty('error');
  // });

  // test('getClan API request success', async () => {
  //   const res = await CR_API.getClan(valid_clantag);
  //   expect(res).toHaveProperty('tag');
  // });

  // // getClanMembers
  // test('getClanMembers API request error', async () => {
  //   const res = await CR_API.getClanMembers(invalid_clantag);
  //   expect(res).toHaveProperty('error');
  // });

  // test('getClanMembers API request success', async () => {
  //   const res = await CR_API.getClanMembers(valid_clantag);
  //   expect(res).toBeInstanceOf(Array);
  // });

  // // getCurrentRiverRace
  // test('getCurrentRiverRace API request error', async () => {
  //   const res = await CR_API.getCurrentRiverRace(invalid_clantag);
  //   expect(res).toHaveProperty('error');
  // });

  // test('getCurrentRiverRace API request success', async () => {
  //   const res = await CR_API.getCurrentRiverRace(valid_clantag);
  //   expect(res).toHaveProperty('state');
  //   expect(res).toHaveProperty('clan');
  //   expect(res).toHaveProperty('clans');
  // });
});

// describe('test cr_api', () => {
//   const valid_playertag = '#P9J292JCL';
// });
