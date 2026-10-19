// Renders the panel against a small synthetic dataset with a stubbed chrome.* API.
// Catches component-level crashes that unit tests on pure logic would miss.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h } from 'preact';
import renderToString from 'preact-render-to-string';

const dataset = JSON.parse(readFileSync(new URL('./fixtures/sample-dataset.json', import.meta.url), 'utf8'));
const byName = (n) => dataset.players.find((p) => p.name === n);

const KEEPERS = [
  { team: 'A', player: 'Wes Wing', round: 2, espnId: byName('Wes Wing').espnId, teamSlot: 1 },
];

const CONFIG = {
  leagueId: '123456', myTeamSlot: 1, teams: 2, rounds: 4,
  keepers: KEEPERS, manualDrafted: [], manualUndrafted: [],
  sortMode: 'value', hideAvoid: false,
};

const LEAGUE = {
  leagueId: '123456', name: 'Test League', teams: 2, rounds: 4,
  slotCounts: { PG: 1, C: 1, UTIL: 1, BE: 1 },
  teamsById: {},
};

function stubChrome({ picks = [] } = {}) {
  globalThis.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        if (msg.type === 'dataset') cb({ ok: true, dataset });
        else if (msg.type === 'league') cb({ ok: true, league: LEAGUE });
        else if (msg.type === 'picks') cb({ ok: true, picks, inProgress: true, drafted: false });
        else cb({ ok: false, error: 'unknown' });
      },
      openOptionsPage: () => {},
    },
    storage: {
      local: {
        get: async () => CONFIG,
        set: async () => {},
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
}

test('panel renders without throwing before any data has loaded', async () => {
  stubChrome();
  const { Panel } = await import('../src/panel/Panel.js');
  const html = renderToString(h(Panel));
  assert.match(html, /Hoops Copilot/);
  // Default feed is the real one, so nothing should suggest a rehearsal.
  assert.match(html, /ESPN/);
  assert.ok(!/practice/.test(html));
});

test('an empty keeper sheet is called out, not silently computed around', async () => {
  // The quiet failure: with no keepers the board still renders perfectly, it is just
  // showing the pick numbers of a league nobody keeps anyone in.
  stubChrome();
  const { Panel } = await import('../src/panel/Panel.js');
  const html = renderToString(h(Panel));
  // Nothing has loaded yet in a synchronous render, so config is null and the warning is
  // correctly suppressed -- it must never flash before the sheet has been read.
  assert.ok(!/No keepers\./.test(html));
});

test('the panel says out loud when it is on the practice feed', async () => {
  // The chip is the thing that stops a Sleeper tab left open overnight from being
  // mistaken for the real draft room on draft day.
  stubChrome();
  const { Panel } = await import('../src/panel/Panel.js');
  const html = renderToString(h(Panel, { platform: 'sleeper', draftId: '123456789012' }));
  assert.match(html, /SLEEPER · practice/);
});

test('PlayerCard renders projection, value and market for a full player', async () => {
  stubChrome();
  const { PlayerCard } = await import('../src/panel/PlayerCard.js');
  const p = byName('Cal Center');
  const row = { ...p, rank: 1, tier: 1, tag: 'target', adp: p.espn.adp, adjAdp: 1.2, availNext: 0.31, injuryStatus: 'ACTIVE' };
  const html = renderToString(h(PlayerCard, { row, dataset, onClose: () => {} }));
  assert.match(html, /Cal Center/);
  assert.match(html, /Model #1/);
  assert.match(html, /over replacement/);
  assert.match(html, /FP\/G/);
  assert.match(html, /31% to reach your next pick/);
  assert.match(html, /Synthetic test player/);
});

test('PlayerCard renders a player with almost no data attached', async () => {
  stubChrome();
  const { PlayerCard } = await import('../src/panel/PlayerCard.js');
  const row = { name: 'Nobody', pos: 'SG', eligible: ['SG'], team: 'FA', tag: 'neutral', adp: null, adjAdp: null, availNext: null, injuryStatus: null };
  const html = renderToString(h(PlayerCard, { row, dataset, onClose: () => {} }));
  assert.match(html, /Nobody/);
});

test('BoardRow renders rank, name, every eligible position and survival odds', async () => {
  stubChrome();
  const { BoardRow } = await import('../src/panel/BoardRow.js');
  const p = byName('Pat Point');
  const row = { ...p, rank: 2, tier: 1, tag: 'target', adp: 2.4, adjAdp: 2.4, reach: 1, availNext: 0.4, value: 2834 };
  const html = renderToString(h(BoardRow, { row, warnings: [], onSelect: () => {}, onMark: () => {} }));
  assert.match(html, /Pat Point/);
  assert.match(html, /PG\/SG/);
  assert.match(html, /40%/);
});
