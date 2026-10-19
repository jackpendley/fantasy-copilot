import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClock, parsePickCard, overallOf } from '../src/content/dom-draft.js';

test('the on-the-clock header gives the live pick number', () => {
  assert.equal(parseClock('ON THE CLOCK: PICK 40'), 40);
  assert.equal(parseClock('On the clock: Pick 7 Team Seven'), 7);
  assert.equal(parseClock('PICK 41 AUTO'), null); // not the clock
});

test('a pick card yields round, pick and player name', () => {
  assert.deepEqual(parsePickCard('Pascal Siakam / IND PF\nR2, P10 - Team Ten Long Name Bu...'),
    { round: 2, roundPick: 10, name: 'Pascal Siakam' });
  assert.deepEqual(parsePickCard('Karl-Anthony Towns / NY C\nR2, P11 - Team Eleven'),
    { round: 2, roundPick: 11, name: 'Karl-Anthony Towns' });
  assert.equal(parsePickCard('Players  Pick History  Board'), null);
});

test('snake labels map to overall pick numbers', () => {
  assert.equal(overallOf(2, 10, 12), 22);
  assert.equal(overallOf(4, 4, 12), 40);
  assert.equal(overallOf(1, 1, 12), 1);
});
