import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, rosterNeeds, worstSeverity, slotAccepts } from '../src/core/rules.js';

const SLOTS = { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 3, BE: 3, IR: 1 };
const row = (o = {}) => ({ name: 'X', pos: 'PG', eligible: ['PG'], reach: 0, adjAdp: 10, rank: 10, tag: 'neutral', injuryStatus: 'ACTIVE', model: { proj: { GP: 75 } }, ...o });

test('an empty roster needs every starting slot and never a bench spot', () => {
  const needs = Object.fromEntries(rosterNeeds([], SLOTS).map((n) => [n.pos, n.need]));
  assert.deepEqual(needs, { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 3 });
});

test('multi-position players are placed so the flexible one covers the gap', () => {
  // A pure PG and a PG/SG: the PG/SG must take SG, not compete for PG.
  const needs = rosterNeeds([{ eligible: ['PG/SG'.split('/')].flat() }, { eligible: ['PG'] }], { PG: 1, SG: 1, UTIL: 1 });
  assert.deepEqual(needs, [{ pos: 'UTIL', need: 1, starters: 1 }]);
});

test('G and F slots accept the right positions', () => {
  assert.ok(slotAccepts('G', ['SG']));
  assert.ok(!slotAccepts('G', ['SF']));
  assert.ok(slotAccepts('F', ['PF', 'C']));
  assert.ok(slotAccepts('UTIL', ['C']));
});

test('reaching warns, falling reads as good', () => {
  assert.ok(evaluate(row({ reach: 25 }), { currentOverall: 5 }).some((w) => w.id === 'reaching'));
  assert.ok(evaluate(row({ reach: -15 }), { currentOverall: 30 }).some((w) => w.id === 'falling' && w.severity === 'good'));
});

test('an OUT player warns; a low-GP projection is a note', () => {
  assert.equal(worstSeverity(evaluate(row({ injuryStatus: 'OUT' }), {})), 'warn');
  assert.ok(evaluate(row({ model: { proj: { GP: 50 } } }), {}).some((w) => w.id === 'gp-risk'));
});

test('late in the draft, a player who fills no open starter is flagged', () => {
  const myRoster = [{ eligible: ['PG'] }, { eligible: ['SG'] }, { eligible: ['SF'] }, { eligible: ['PF'] }];
  const slots = { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, BE: 1 };
  const ctx = { round: 5, totalRounds: 6, myRoster, slots };
  assert.ok(evaluate(row({ eligible: ['PG'] }), ctx).some((w) => w.id === 'roster-fit'));
  assert.ok(!evaluate(row({ eligible: ['PF', 'C'] }), ctx).some((w) => w.id === 'roster-fit'));
});

test('a flexible player is re-seated when that lets everyone start (Sabonis to PF)', () => {
  // C-only, then PF/C: the PF/C must move to PF so both start, leaving nothing at C or PF.
  const needs = rosterNeeds([{ eligible: ['PF', 'C'] }, { eligible: ['C'] }], { PF: 1, C: 1, UTIL: 1 });
  assert.deepEqual(needs, [{ pos: 'UTIL', need: 1, starters: 1 }]);
  // A third big who is C-only fits UTIL; a fourth fits nothing.
  const three = rosterNeeds([{ eligible: ['PF', 'C'] }, { eligible: ['C'] }, { eligible: ['C'] }], { PF: 1, C: 1, UTIL: 1 });
  assert.deepEqual(three, []);
});
