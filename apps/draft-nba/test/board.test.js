import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBoard, sortBoard, filterBoard, tierStatus, marketTag } from '../src/core/board.js';

const dataset = JSON.parse(readFileSync(new URL('./fixtures/sample-dataset.json', import.meta.url), 'utf8'));
const id = (n) => dataset.players.find((p) => p.name === n).espnId;

test('kept and drafted players never appear on the board', () => {
  const rows = buildBoard(dataset, { draftedIds: new Set([id('Cal Center')]), keptIds: new Set([id('Pat Point')]) });
  assert.ok(!rows.some((r) => r.name === 'Cal Center' || r.name === 'Pat Point'));
  assert.equal(rows.length, dataset.players.length - 2);
});

test('adjusted ADP accounts for the kept player ahead of them', () => {
  const rows = buildBoard(dataset, { keptIds: new Set([id('Cal Center')]) });
  const wes = rows.find((r) => r.name === 'Wes Wing');
  assert.equal(wes.adjAdp, 2.6); // 3.6 minus the one kept player ahead
});



test('model sort is pure model order; take-now sort is descending within a need tier', () => {
  const rows = buildBoard(dataset, { currentOverall: 1, myNextOverall: 4 });
  assert.deepEqual(sortBoard(rows, 'model').map((r) => r.rank), dataset.players.map((p) => p.model.rank));
  const v = sortBoard(rows, 'value');
  for (let i = 1; i < v.length; i++) {
    if (v[i].need === v[i - 1].need) assert.ok(v[i].takeNow <= v[i - 1].takeNow);
  }
});

test('position filter matches any eligible position', () => {
  const rows = buildBoard(dataset, {});
  const cs = filterBoard(rows, { positions: ['C'] }).map((r) => r.name);
  assert.ok(cs.includes('Gus Glass')); // PF/C
  assert.ok(cs.includes('Cal Center'));
  assert.ok(!cs.includes('Pat Point'));
});

test('market tag flags value and overpay with a band that widens with rank', () => {
  assert.equal(marketTag(10, 30), 'target');
  assert.equal(marketTag(10, 15), 'neutral');
  assert.equal(marketTag(40, 20), 'avoid');
  assert.equal(marketTag(100, 85), 'neutral'); // 15 picks is noise at 100
  assert.equal(marketTag(5, null), 'neutral');
});

test('tierStatus groups by overall tier and flags a breaking one', () => {
  const rows = buildBoard(dataset, {});
  const t = tierStatus(rows);
  assert.ok(t.length >= 1);
  assert.equal(t.reduce((a, x) => a + x.remaining, 0), rows.filter((r) => r.tier != null).length);
  assert.ok(t.every((x) => x.breaking === (x.remaining <= 2)));
});

test('a player who cannot start for me is valued as bench, one who fills a hole is not', async () => {
  const { buildBoard, BENCH_WEIGHT } = await import('../src/core/board.js');
  const slots = { PG: 1, C: 1, UTIL: 1, BE: 1 };
  // I already have two centers: C and UTIL are taken by them.
  const myRoster = [{ eligible: ['C'] }, { eligible: ['C'] }];
  const rows = buildBoard(dataset, { myRoster, slots, currentOverall: 5, myNextOverall: 8 });
  const ben = rows.find((r) => r.name === 'Ben Bench');     // C only
  const pat = rows.find((r) => r.name === 'Pat Point');     // PG/SG
  assert.equal(ben.fitFactor, BENCH_WEIGHT);
  assert.equal(pat.fitFactor, 1);
});


test('bench: a guard who adds coverage beats a third bench big; a full bench is worth nothing', async () => {
  const { fitter, BENCH_WEIGHT, BENCH_DUP_WEIGHT } = await import('../src/core/board.js');
  const slots = { C: 1, BE: 2 };
  const fit = fitter(slots);
  const roster = [{ eligible: ['C'] }, { eligible: ['C'] }]; // one starts, one on the bench
  assert.equal(fit(roster, ['PG']), BENCH_WEIGHT);       // new group on the bench
  assert.equal(fit(roster, ['C']), BENCH_DUP_WEIGHT);    // another big: duplicate
  assert.equal(fit([...roster, { eligible: ['PG'] }], ['SF']), 0); // bench already full
});

test('fits filter: starters and new bench groups show, duplicate bench pieces do not', async () => {
  const { filterBoard, BENCH_WEIGHT, BENCH_DUP_WEIGHT } = await import('../src/core/board.js');
  const rows = [
    { name: 'starter', fitFactor: 1 }, { name: 'bench C', fitFactor: BENCH_WEIGHT },
    { name: 'second bench C', fitFactor: BENCH_DUP_WEIGHT }, { name: 'no room', fitFactor: 0 },
  ];
  assert.deepEqual(filterBoard(rows, { fitsOnly: true }).map((r) => r.name), ['starter', 'bench C']);
});

test('hide will-last never hides the best take-now options, even if they would last', async () => {
  const { filterBoard } = await import('../src/core/board.js');
  const rows = [
    { name: 'Sabonis', takeNow: 100, availNext: 0.83 },
    { name: 'Lock', takeNow: 99, availNext: 0.99 },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({ name: `lasts${i}`, takeNow: 50 - i, availNext: 0.9 })),
    { name: 'goes', takeNow: 10, availNext: 0.2 },
  ];
  const names = filterBoard(rows, { hideLasting: true }).map((r) => r.name);
  assert.ok(names.includes('Sabonis'));        // best pick, kept
  assert.ok(names.includes('goes'));           // won't last, kept
  assert.ok(!names.includes('lasts6'));        // can wait and not top-5, hidden
  assert.ok(!names.includes('Lock'));          // top-5 but 99% to last: hidden
  assert.deepEqual(names, ['Sabonis', 'lasts1', 'lasts2', 'lasts3', 'goes']);
});

test('a player better than my weakest starter is an upgrade, not a bench piece', async () => {
  const { upgrader, BENCH_WEIGHT } = await import('../src/core/board.js');
  const slots = { F: 1, C: 1, UTIL: 1, BE: 2 };
  // Lineup full: F (weak forward), C, UTIL (a forward re-seatable at F).
  const roster = [
    { name: 'Weak F', eligible: ['SF'], model: { overFA: 50 } },
    { name: 'Big', eligible: ['C'], model: { overFA: 500 } },
    { name: 'Wing', eligible: ['SF', 'PF'], model: { overFA: 300 } },
  ];
  const up = upgrader(slots)(roster, ['PF'], 400);
  assert.equal(up.over, 'Weak F');
  assert.equal(up.value, 400 - 50 + BENCH_WEIGHT * 50);
  assert.equal(upgrader(slots)(roster, ['PF'], 40), null); // not better than anyone
});

test('bench structure: after a bench big, bigs are out and a guard/forward bench pick leads', async () => {
  const { buildBoard, sortBoard, filterBoard } = await import('../src/core/board.js');
  const slots = { PG: 1, C: 1, BE: 3 };
  const myRoster = [
    { name: 'S1', eligible: ['PG'], model: { overFA: 900 } },
    { name: 'S2', eligible: ['C'], model: { overFA: 900 } },
    { name: 'Bench big', eligible: ['C'], model: { overFA: 400 } },
  ];
  const rows = buildBoard(dataset, { myRoster, slots, currentOverall: 9, myNextOverall: 12, picksLeft: 2 });
  const top = sortBoard(filterBoard(rows, { fitsOnly: true }), 'value');
  assert.ok(top.length > 0);
  assert.ok(top.every((r) => !r.eligible.includes('C')), top.map((r) => r.name).join(','));
  assert.ok(!top.some((r) => r.upgradeOver && r.eligible.includes('C')));
});

test('take now is value over next available at the position: deep bigs wait, a scarce guard goes', async () => {
  const { scoreTakeNow } = await import('../src/core/board.js');
  const rows = [
    { name: 'Kessler', eligible: ['C'], baseValue: 1239, availNext: 0.85 },
    { name: 'Gobert', eligible: ['C'], baseValue: 1180, availNext: 0.89 },
    { name: 'Zubac', eligible: ['C'], baseValue: 1026, availNext: 0.93 },
    { name: 'Daniels', eligible: ['PG', 'SG'], baseValue: 847, availNext: 0.56 },
    { name: 'Late guard', eligible: ['PG'], baseValue: 300, availNext: 0.95 },
  ];
  scoreTakeNow(rows);
  const by = Object.fromEntries(rows.map((r) => [r.name, r.takeNow]));
  assert.ok(by.Daniels > by.Kessler, JSON.stringify(by));
  assert.ok(by.Kessler > by.Gobert);
});

test('take now: a star nobody can replace has a large edge', async () => {
  const { scoreTakeNow } = await import('../src/core/board.js');
  const rows = [
    { name: 'Star', eligible: ['C'], baseValue: 3000, availNext: 0.1 },
    { name: 'Big', eligible: ['C'], baseValue: 900, availNext: 0.9 },
    { name: 'Guard', eligible: ['PG'], baseValue: 800, availNext: 0.2 },
  ];
  scoreTakeNow(rows);
  assert.equal(rows.sort((a, b) => b.takeNow - a.takeNow)[0].name, 'Star');
});
