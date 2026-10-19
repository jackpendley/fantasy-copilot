// Locks in how we read ESPN's league payloads. The settings fixture is a real 2027 basketball
// response from ESPN's public league-defaults endpoint (plus synthetic teams), so the slot ids are genuine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = JSON.parse(readFileSync(new URL('./fixtures/league-mSettings.json', import.meta.url), 'utf8'));
const draftDetail = JSON.parse(readFileSync(new URL('./fixtures/league-mDraftDetail.json', import.meta.url), 'utf8'));

function stubFetch(payload) {
  // No ESPN tab available, so the fetcher falls through to a direct call.
  globalThis.chrome = { runtime: { lastError: null }, tabs: { query: async () => [], sendMessage: (_i, _m, cb) => cb(null) } };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => payload });
}

test('league settings map to the right roster slots and round count', async () => {
  stubFetch(settings);
  const { fetchLeague } = await import('../src/core/espn-api.js');
  const l = await fetchLeague('123');

  assert.equal(l.teams, 10);
  assert.equal(l.name, 'Test League');
  assert.equal(l.isKeeper, false);
  // ESPN slot ids: 0-4 PG..C, 5=G 6=F 11=UTIL 12=BE 13=IR (7-10 are the combo slots, off by default)
  const used = Object.fromEntries(Object.entries(l.slotCounts).filter(([, n]) => n > 0));
  assert.deepEqual(used, { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 3, BE: 3, IR: 1 });
  // Rounds = every slot except IR: 7 positional + 3 UTIL + 3 bench
  assert.equal(l.rounds, 13);
  assert.equal(Object.keys(l.teamsById).length, 10);
  assert.equal(l.teamsById[1].name, 'Team1 X');
});

test('draft picks come back sorted by overall pick, keeper flag preserved', async () => {
  stubFetch(draftDetail);
  const { fetchDraftPicks } = await import('../src/core/espn-api.js');
  const d = await fetchDraftPicks('123');

  assert.equal(d.inProgress, true);
  assert.equal(d.drafted, false);
  assert.deepEqual(d.picks.map((p) => p.overall), [1, 2, 3]);
  assert.equal(d.picks[1].keeper, true);
  assert.equal(d.picks[1].playerId, 4430807);
  assert.equal(d.picks[2].round, 1);
});

test('a 401 surfaces actionable guidance, not a raw status', async () => {
  globalThis.chrome = { runtime: { lastError: null }, tabs: { query: async () => [], sendMessage: (_i, _m, cb) => cb(null) } };
  globalThis.fetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' });
  const { fetchLeague } = await import('../src/core/espn-api.js');
  // This league is private, so a 401 means the cookie did not come along --
  // the fix is to be signed in with an ESPN tab open, and the message should say so.
  await assert.rejects(() => fetchLeague('123'), /not authorized.*signed in/is);
});

test('empty pick slots (playerId -1, as ESPN lists the whole board up front) are skipped', async () => {
  const blank = { draftDetail: { inProgress: true, picks: [
    { overallPickNumber: 1, roundId: 1, roundPickNumber: 1, teamId: 12, playerId: 3112335 },
    { overallPickNumber: 2, roundId: 1, roundPickNumber: 2, teamId: 8, playerId: -1 },
  ] } };
  stubFetch(blank);
  const { fetchDraftPicks } = await import('../src/core/espn-api.js');
  const d = await fetchDraftPicks('123');
  assert.deepEqual(d.picks.map((p) => p.playerId), [3112335]);
});
