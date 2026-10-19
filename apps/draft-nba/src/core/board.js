// Board assembly: merge the model dataset with live draft state, score value, and
// derive the tier/run signals. Pure functions -- no DOM, no chrome.*.

import { keeperAdjustedAdp, availabilityAt } from './keepers.js';
import { seatRoster, groupsOf } from './rules.js';

// Share of a player's value he keeps when he cannot start for you: bench players still
// play the days a starter at their position sits (daily lineups), but rarely. A bench
// player who adds a position group (G / F / C) the bench lacks is worth the full bench
// weight; a duplicate of a covered group much less; past the bench's size, nothing.
export const BENCH_WEIGHT = 0.3;
export const BENCH_DUP_WEIGHT = 0.1;

export const TAG_ORDER = { target: 0, neutral: 1, pass: 2, avoid: 3 };
export const TAG_LABEL = { target: 'Model > market', neutral: '', pass: '', avoid: 'Market > model' };

/**
 * Model-vs-market tag: 'target' when our rank is well ahead of ESPN ADP (he should come
 * cheaper than he's worth), 'avoid' when the market drafts him well before we rank him.
 * The band widens with rank because late-round ADP is noisy.
 */
export function marketTag(rank, adp) {
  if (rank == null || adp == null) return 'neutral';
  const band = Math.max(8, 0.25 * rank);
  const diff = adp - rank;
  if (diff >= band) return 'target';
  if (diff <= -band) return 'avoid';
  return 'neutral';
}

/**
 * @param dataset      dist/dataset.json
 * @param state {
 *   draftedIds:  Set of espnIds already taken
 *   keptIds:     Set of espnIds kept (never enter the pool)
 *   currentOverall: the live overall pick number
 *   myNextOverall:  overall number of my next pick (null if none left)
 * }
 */
export function buildBoard(dataset, state) {
  const {
    draftedIds = new Set(), keptIds = new Set(),
    currentOverall = 1, myNextOverall = null, myRoster = [], slots = {}, picksLeft = null,
  } = state;
  const fit = fitter(slots, picksLeft);
  const upgrade = upgrader(slots);

  const adjAdp = keeperAdjustedAdp(
    dataset.players.map((p) => ({ espnId: p.espnId, adp: p.espn.adp })),
    keptIds,
  );

  const rows = [];
  for (const p of dataset.players) {
    if (keptIds.has(p.espnId) || draftedIds.has(p.espnId)) continue;
    const a = adjAdp.get(p.espnId) ?? null;
    const rank = p.model.rank;

    // Chance this player is gone before my next turn.
    const availNext = myNextOverall != null ? availabilityAt(a, myNextOverall) : null;
    const urgency = availNext == null ? null : 1 - availNext;

    // How many picks early I'd be taking them relative to the adjusted market.
    const reach = a == null ? null : a - currentOverall;
    // How far the model is ahead of the market on them (positive = we like them more).
    const edge = (a == null || rank == null) ? null : a - rank;

    const eligible = p.eligible || [p.pos];
    let fitFactor = fit(myRoster, eligible);
    // Worth to MY team: over a free agent at his position (what an empty slot gets), scaled
    // by whether he can start for me. Model rank/value stay the league-wide view.
    const own = Math.max(0, p.model.overFA ?? p.model.value ?? 0);
    let baseValue = own * fitFactor;
    // Starters full (or he would only sit): could he start over my weakest starter instead?
    let upgradeOver = null;
    // Never revive a structural zero (a wasted pick) as an "upgrade".
    if (fitFactor > 0 && fitFactor < 1 && myRoster.length) {
      const up = upgrade(myRoster, eligible, own);
      if (up && up.value > baseValue) { baseValue = up.value; upgradeOver = up.over; fitFactor = 1; }
    }

    rows.push({
      espnId: p.espnId, name: p.name, pos: p.pos, eligible, team: p.team, fitFactor, upgradeOver,
      // Roster-structure tier for "take now": 0 starts for me, 1 fills a bench group, 2 neither.
      need: fitFactor >= 1 ? 0 : (fitFactor >= BENCH_WEIGHT ? 1 : 2),
      rank, posRank: p.model.posRank, tier: p.model.tier, tag: marketTag(rank, a),
      value: p.model.value, adp: p.espn.adp, adjAdp: a, injuryStatus: p.espn.injuryStatus,
      reach, edge, availNext, takeNow: baseValue, baseValue, overFA: p.model.overFA ?? p.model.value,
      model: p.model, espn: p.espn,
    });
  }
  if (myNextOverall != null) scoreTakeNow(rows);
  return rows;
}

const rosterValue = (x) => Math.max(0, x.model?.overFA ?? x.model?.value ?? x.value ?? 0);

/**
 * upgrade(roster, eligible, value) -> { value, over } when a player with these positions
 * could start in place of one of my current starters (after re-seating everyone): his
 * value minus that starter's, plus the displaced starter's bench value if there is bench
 * room. Tries my weakest starters first. Null when he can't displace anyone usefully.
 */
export function upgrader(slots) {
  const benchSize = slots?.BE ?? 0;
  return (roster, eligible, value) => {
    const seated = seatRoster(roster, slots);
    if (seated.needs.length) return null; // an open slot: fitter already handles that
    const benchedSet = new Set(seated.benched);
    const starters = roster
      .map((x, i) => ({ x, i }))
      .filter((r) => !benchedSet.has(seated.all[r.i]))
      .sort((a, b) => rosterValue(a.x) - rosterValue(b.x));
    for (const st of starters) {
      const without = roster.filter((_, i) => i !== st.i);
      if (seatRoster([...without, { eligible }], slots).needs.length) continue;
      const v = rosterValue(st.x);
      if (value <= v) return null; // the weakest starter he could replace is already better
      const benchKeeps = benchSize && seated.benched.length < benchSize ? BENCH_WEIGHT * v : 0;
      return { value: value - v + benchKeeps, over: st.x.name || (st.x.eligible || [st.x.pos]).join('/') };
    }
    return null;
  };
}

/**
 * fit(roster, eligible) -> 1 if adding a player with these positions fills an open
 * starting slot on this roster (after re-seating everyone optimally), else BENCH_WEIGHT.
 * Cached by roster size + eligibility, since that is all the answer depends on.
 */
export function fitter(slots, picksLeft = null) {
  const hasSlots = Object.entries(slots || {}).some(([k, n]) => n > 0 && k !== 'BE' && k !== 'IR');
  const cache = new Map();
  const benchSize = slots?.BE ?? 0;
  const seat = (roster) => seatRoster(roster, slots);
  const open = (seated) => seated.needs.reduce((a, n) => a + n.need, 0);
  return (roster, eligible) => {
    if (!hasSlots) return 1;
    const key = `${roster.map((r) => (r.eligible || [r.pos]).join('/')).sort().join(',')}|${eligible.join('/')}|${roster.baseLen ?? ''}`;
    if (!cache.has(key)) {
      const s0 = seat(roster);
      const s1 = seat([...roster, { eligible }]);
      const before = open(s0);
      const fills = open(s1) < before;
      // Out of picks to waste: once my remaining picks (counting this one) only just
      // cover my open starting slots, a player who fills none of them is worth nothing.
      const mustFill = picksLeft != null && before > 0 && picksLeft - (roster.length - (roster.baseLen ?? roster.length)) <= before;
      const left = picksLeft == null ? null : picksLeft - (roster.length - (roster.baseLen ?? roster.length));
      const addsGroup = s1.benchGroups.length > s0.benchGroups.length;
      // Same idea for the bench: once my picks only just cover the G/F/C groups the bench
      // still lacks, a duplicate is a wasted pick.
      const benchMissing = Math.min(Math.max(0, benchSize - s0.benched.length), 3 - s0.benchGroups.length);
      const mustCover = left != null && before === 0 && benchMissing > 0 && left <= benchMissing;
      // Picks I can't spare: every remaining pick is needed for an open starter or a
      // missing bench group, so a duplicate is wasted.
      const tight = left != null && left <= before + benchMissing;
      let f;
      if (fills) f = 1;
      else if (mustFill || (benchSize && s1.benched.length > benchSize)) f = 0;
      else if (addsGroup) f = BENCH_WEIGHT;
      else f = (mustCover || tight) ? 0 : BENCH_DUP_WEIGHT;
      cache.set(key, f);
    }
    return cache.get(key);
  };
}

/**
 * "Take now" = value over next available (VONA) at his position group. Taking A now is
 * worth his value minus what I'd expect to get at the same position group (guard /
 * forward / big) with my next pick if I wait: the best of the others in that group, each
 * the best one left with probability (he survives) x (every better one got taken).
 * A deep group (five similar bigs, most of whom will last) has a small VONA, so the board
 * says take the scarce player now and the big next time.
 */
export function scoreTakeNow(rows) {
  const byGroup = new Map();
  for (const r of rows) {
    for (const g of groupsOf(r.eligible || [r.pos])) {
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(r);
    }
  }
  for (const list of byGroup.values()) list.sort((x, y) => y.baseValue - x.baseValue);
  for (const a of rows) {
    const groups = groupsOf(a.eligible || [a.pos]);
    // A wing counts in both G and F; judge him by the group where waiting costs least.
    let nextBest = Infinity;
    for (const g of groups) {
      let expected = 0;
      let noneBetter = 1;
      for (const b of byGroup.get(g) || []) {
        if (b === a) continue;
        expected += noneBetter * (b.availNext ?? 0) * b.baseValue;
        noneBetter *= 1 - (b.availNext ?? 0);
        if (noneBetter < 1e-4) break;
      }
      nextBest = Math.min(nextBest, expected);
    }
    if (!Number.isFinite(nextBest)) nextBest = 0;
    a.takeNow = a.baseValue - nextBest;
  }
  return rows;
}

export const SORTS = {
  model: (a, b) => (a.rank ?? 9999) - (b.rank ?? 9999),
  // Starters first, then bench groups I lack, then the rest; best take-now within each.
  value: (a, b) => (a.need ?? 0) - (b.need ?? 0) || b.takeNow - a.takeNow,
  adp: (a, b) => (a.adjAdp ?? 9999) - (b.adjAdp ?? 9999),
  edge: (a, b) => (b.edge ?? -9999) - (a.edge ?? -9999),
};

export function sortBoard(rows, mode = 'value') {
  return [...rows].sort(SORTS[mode] || SORTS.value);
}

// At or above this chance of lasting to my next pick, a player can wait.
export const WILL_LAST = 0.75;
// Hide will-last never hides this many of the top "take now" options...
export const KEEP_BEST = 5;
// ...unless he is all but certain to be there at my next pick.
export const SURE_TO_LAST = 0.95;

export function filterBoard(rows, { positions, hideAvoid, targetsOnly, search, fitsOnly, hideLasting } = {}) {
  let out = rows;
  // Useful to MY roster: starts, or adds a position group (G/F/C) the bench lacks.
  // Duplicate bench pieces and players with no room left are hidden.
  if (fitsOnly) out = out.filter((r) => r.fitFactor == null || r.fitFactor >= BENCH_WEIGHT);
  if (hideLasting) {
    // Hide players who can wait -- but never the best few picks right now. A player
    // likely to last can still be the right pick (Sabonis at 10 with the next pick at 15).
    const best = new Set([...out].sort(SORTS.value).slice(0, KEEP_BEST));
    out = out.filter((r) => r.availNext == null
      || r.availNext < WILL_LAST
      || (best.has(r) && r.availNext < SURE_TO_LAST));
  }
  if (positions && positions.length) out = out.filter((r) => r.eligible.some((e) => positions.includes(e)));
  if (hideAvoid) out = out.filter((r) => r.tag !== 'avoid');
  if (targetsOnly) out = out.filter((r) => r.tag === 'target');
  if (search) {
    const q = search.toLowerCase();
    out = out.filter((r) => r.name.toLowerCase().includes(q) || r.team.toLowerCase().includes(q));
  }
  return out;
}

/**
 * How many players remain in each overall value tier, and which tiers are about to break.
 * Tiers come from gaps in value over replacement (value.js assignTiers).
 */
export function tierStatus(rows) {
  const byTier = new Map();
  for (const r of rows) {
    if (r.tier == null) continue;
    if (!byTier.has(r.tier)) byTier.set(r.tier, []);
    byTier.get(r.tier).push(r);
  }
  const out = [];
  for (const [tier, players] of byTier) {
    out.push({
      pos: 'ALL', tier, remaining: players.length,
      players: players.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)),
      breaking: players.length <= 2,
    });
  }
  return out.sort((a, b) => a.tier - b.tier);
}

/**
 * Positional run detection over the last N picks.
 * @param recentPicks [{ pos }] most recent last
 */
export function positionRuns(recentPicks, windowSize = 8) {
  const w = recentPicks.slice(-windowSize);
  if (w.length < 4) return [];
  const counts = {};
  for (const p of w) counts[p.pos] = (counts[p.pos] || 0) + 1;
  return Object.entries(counts)
    .filter(([, n]) => n / w.length >= 0.5 && n >= 3)
    .map(([pos, n]) => ({ pos, count: n, of: w.length }))
    .sort((a, b) => b.count - a.count);
}
