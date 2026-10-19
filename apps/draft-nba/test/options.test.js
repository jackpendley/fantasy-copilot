// The options page carries the most hand-written UI and drives everything the panel
// reads, so at minimum it must render on both feeds without throwing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h } from 'preact';
import renderToString from 'preact-render-to-string';

const dataset = JSON.parse(readFileSync(new URL('./fixtures/sample-dataset.json', import.meta.url), 'utf8'));

function stubChrome(config) {
  globalThis.chrome = {
    runtime: {
      sendMessage: (msg, cb) => cb(msg.type === 'dataset' ? { ok: true, dataset } : { ok: true }),
      openOptionsPage: () => {}, getURL: (p) => p, lastError: null,
    },
    storage: {
      local: { get: async () => config, set: async () => {} },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
}

const CONFIG = {
  platform: 'espn', leagueId: '123', myTeamSlot: 5, teams: 12, rounds: 16,
  sleeperDraftId: '1000000000000000002', sleeperUsername: 'testuser', sleeperSlot: 4,
  keepers: [{ team: 'Jack', player: 'Wes Wing', round: 6, espnId: 9000002, teamSlot: 5 }],
  manualDrafted: [], manualUndrafted: [],
};

test('options renders the whole page on the ESPN feed', async () => {
  stubChrome(CONFIG);
  const { App } = await import('../src/options/options.js');
  const html = renderToString(h(App, { initialConfig: CONFIG }));

  assert.match(html, /ESPN League ID/);
  assert.match(html, /Replay 2026 ESPN draft/);
  assert.match(html, /Your real picks from slot 5/);
  // ESPN only: no Sleeper rehearsal in the basketball tool.
  assert.ok(!/Sleeper/.test(html));
  assert.match(html, /Wes Wing/); // keeper sheet still renders
});
