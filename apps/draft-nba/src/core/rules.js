// Guardrails on the player you are about to take: market timing, roster fit, injury risk,
// and (category leagues) punt coherence. Each returns a nudge, never a hard stop.
//
// Severity: 'block' = almost certainly wrong; 'warn' = think twice; 'note' = FYI;
//           'good' = this actively matches what the model is hunting for.

import { SLOT_ACCEPTS } from './value.js';

/**
 * @param row       a board row (from buildBoard) for the player under consideration
 * @param ctx {
 *   round, currentOverall, totalRounds,
 *   myRoster: [{ pos, eligible, name, model }],
 *   slots: league starting slots,
 *   rules: dataset.rules,
 * }
 * @returns [{ id, severity, title, detail }]
 */
export function evaluate(row, ctx) {
  const out = [];
  const { round = 1, totalRounds = 13, myRoster = [], slots = {}, rules } = ctx;

  // Market timing: the adjusted ADP says he'd still be there later.
  if (row.reach != null && row.reach >= 20) {
    out.push({
      id: 'reaching', severity: 'warn',
      title: `Reach: ${Math.round(row.reach)} picks ahead of the market`,
      detail: `Keeper-adjusted ADP is ${row.adjAdp.toFixed(0)}; you're on the clock at ${ctx.currentOverall}. `
        + (row.availNext != null ? `${Math.round(row.availNext * 100)}% chance he lasts to your next pick.` : ''),
    });
  }
  if (row.reach != null && row.reach <= -12) {
    out.push({
      id: 'falling', severity: 'good',
      title: `Falling: ${Math.round(-row.reach)} picks past his ADP`,
      detail: 'The room has passed on him. Check the injury status, then this is a discount.',
    });
  }

  if (row.tag === 'target') {
    out.push({ id: 'tag-target', severity: 'good', title: 'Model ranks him well ahead of ESPN ADP', detail: `Model #${row.rank} vs ADP ${row.adjAdp?.toFixed(0)}.` });
  } else if (row.tag === 'avoid') {
    out.push({ id: 'tag-avoid', severity: 'note', title: 'Market likes him more than the model', detail: `Model #${row.rank} vs ADP ${row.adjAdp?.toFixed(0)}. Under this league's scoring he is worth less than his draft price.` });
  }

  const inj = row.injuryStatus;
  if (inj && inj !== 'ACTIVE') {
    out.push({ id: 'injury', severity: inj === 'OUT' || inj === 'INJURY_RESERVE' ? 'warn' : 'note', title: `Injury: ${inj.replace('_', ' ').toLowerCase()}`, detail: `Projected ${row.model?.proj?.GP?.toFixed(0) ?? '?'} games.` });
  } else if ((row.model?.proj?.GP ?? 82) < 62) {
    out.push({ id: 'gp-risk', severity: 'note', title: `Availability risk: ${row.model.proj.GP.toFixed(0)} projected games`, detail: 'The projection already prices this in; stacking several of these raises week-to-week variance.' });
  }

  // Roster fit: late in the draft, does he fill an empty starting slot?
  const left = totalRounds - round + 1;
  const needs = rosterNeeds(myRoster, slots);
  const openStarters = needs.reduce((a, n) => a + n.need, 0);
  if (openStarters && left <= openStarters + 1) {
    const fills = needs.some((n) => slotAccepts(n.pos, row.eligible || [row.pos]));
    if (!fills) {
      out.push({ id: 'roster-fit', severity: 'warn', title: 'Doesn\'t fill an open starting slot', detail: `${left} picks left, still need ${needs.map((n) => n.pos).join(', ')}.` });
    }
  }

  // Category leagues: strong in a category you're punting means you're paying for wasted value.
  const punt = rules?.scoring?.punt || [];
  if (punt.length && row.model?.z) {
    // z for punted categories isn't in model.z (value.js drops them); look at raw lines instead.
    const strong = punt.filter((c) => (c === 'FT%' && (row.model.proj['FT%'] ?? 1) > 0.85 && (row.model.proj.FTA ?? 0) >= 5)
      || (c === 'FG%' && (row.model.proj['FG%'] ?? 0) > 0.52) || (c === 'TO' && (row.model.proj.TO ?? 9) < 1.2));
    if (strong.length) out.push({ id: 'punt-coherence', severity: 'note', title: `Strong in a punted category (${strong.join(', ')})`, detail: 'Part of his value is in a category you are giving up.' });
  }
  return out;
}

/** Worst severity present, for badge color. */
export function worstSeverity(warnings) {
  for (const s of ['block', 'warn', 'note', 'good']) {
    if (warnings.some((w) => w.severity === s)) return s;
  }
  return null;
}

export const slotAccepts = (slot, eligible) => (SLOT_ACCEPTS[slot] || []).some((p) => eligible.includes(p));

/**
 * Open starting slots after seating my roster in the best possible arrangement (maximum
 * bipartite matching of players to slots, so a PF/C counts at PF or C, whichever leaves
 * more slots fillable). Slots are offered most-restrictive first, so what's left open is
 * the flexible ones whenever there is a choice.
 * @param myRoster [{ pos, eligible }]
 * @param slots    { PG:1, SG:1, SF:1, PF:1, C:1, G:1, F:1, UTIL:2, BE:3, IR:1 }
 */
export function rosterNeeds(myRoster, slots) {
  return seatRoster(myRoster, slots).needs;
}

// Bench coverage groups: one sub per group covers any starter's off night.
export const BENCH_GROUPS = { G: ['PG', 'SG'], F: ['SF', 'PF'], C: ['C'] };
// Any C-eligible player is a big and only covers C (a PF/C is not the bench forward);
// wings (SG/SF) cover both G and F.
export const groupsOf = (eligible) => (eligible.includes('C') ? ['C']
  : Object.keys(BENCH_GROUPS).filter((g) => BENCH_GROUPS[g].some((p) => eligible.includes(p))));

/**
 * Best seating of my roster: { needs (open starting slots), benched (eligibility of each
 * player left on the bench), benchGroups (G/F/C groups the bench already covers) }.
 */
export function seatRoster(myRoster, slots) {
  const open = Object.entries(slots || {})
    .filter(([s, n]) => s !== 'BE' && s !== 'IR' && n > 0 && SLOT_ACCEPTS[s])
    .flatMap(([s, n]) => Array(n).fill(s))
    .sort((a, b) => SLOT_ACCEPTS[a].length - SLOT_ACCEPTS[b].length);
  const players = myRoster.map((p) => (p.eligible?.length ? p.eligible : [p.pos]));
  const slotOwner = new Array(open.length).fill(-1);
  const tryPlace = (pi, seen) => {
    // Prefer a free slot (most restrictive first); only bump someone if none is free.
    for (let si = 0; si < open.length; si++) {
      if (slotOwner[si] === -1 && !seen[si] && slotAccepts(open[si], players[pi])) { slotOwner[si] = pi; return true; }
    }
    for (let si = 0; si < open.length; si++) {
      if (seen[si] || !slotAccepts(open[si], players[pi])) continue;
      seen[si] = true;
      if (slotOwner[si] === -1 || tryPlace(slotOwner[si], seen)) { slotOwner[si] = pi; return true; }
    }
    return false;
  };
  // Least flexible players first, so the matching starts from the natural seating.
  const orderIdx = players.map((_, i) => i).sort((a, b) => players[a].length - players[b].length);
  for (const pi of orderIdx) tryPlace(pi, new Array(open.length).fill(false));
  const counts = {};
  open.forEach((s, si) => { if (slotOwner[si] === -1) counts[s] = (counts[s] || 0) + 1; });
  const seated = new Set(slotOwner.filter((x) => x >= 0));
  const benched = players.filter((_, i) => !seated.has(i));
  const benchGroups = [...new Set(benched.flatMap(groupsOf))];
  return {
    needs: Object.entries(counts).map(([pos, need]) => ({ pos, need, starters: slots[pos] })),
    benched, benchGroups,
    all: players, // eligibility arrays by roster index (the same objects as in `benched`)
  };
}
