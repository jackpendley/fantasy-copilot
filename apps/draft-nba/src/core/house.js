// League house rules that ESPN's settings don't encode (they live in the group chat).
// Each knob in rules.house is applied here, explicitly, so the model's deviations from
// ESPN's own scoring are visible and auditable. Unknown knobs are ignored.
//
// rules.house = {
//   notes: [string],                    // free-text record of the chat's rules
//   statBonus: { STAT: points },        // extra points layered onto ESPN's scoring (points leagues)
//   gpCap: number|null,                 // max games that can count for a player (e.g. a weekly cap, annualized)
//   gpWeight: number|null,              // 0..1: how much availability matters (1 = full season totals)
//   playerGpMult: { name: mult },       // e.g. suspensions / known absences
// }

export function applyHouseRules(players, rules) {
  const h = rules.house || {};
  const applied = [];
  const out = rules.scoring.type === 'points' && h.statBonus && Object.keys(h.statBonus).length
    ? { ...rules, scoring: { ...rules.scoring, points: mergePoints(rules.scoring.points, h.statBonus) } }
    : { ...rules };
  if (out !== rules && h.statBonus && Object.keys(h.statBonus).length) applied.push(`stat bonus ${JSON.stringify(h.statBonus)}`);

  let ps = players;
  if (h.gpCap) {
    ps = ps.map((p) => (p.line.GP > h.gpCap ? { ...p, line: { ...p.line, GP: h.gpCap } } : p));
    applied.push(`GP capped at ${h.gpCap}`);
  }
  if (h.gpWeight != null && h.gpWeight < 1) {
    // Shrink each player's GP toward a full-ish 75 so availability matters less.
    ps = ps.map((p) => ({ ...p, line: { ...p.line, GP: 75 + (p.line.GP - 75) * h.gpWeight } }));
    applied.push(`GP weight ${h.gpWeight}`);
  }
  if (h.playerGpMult) {
    ps = ps.map((p) => {
      const m = h.playerGpMult[p.name];
      return m == null ? p : { ...p, line: { ...p.line, GP: p.line.GP * m }, houseNotes: [`GP x${m} (house)`] };
    });
    applied.push(`per-player GP adjustments: ${Object.keys(h.playerGpMult).length}`);
  }
  return { players: ps, rules: out, applied };
}

function mergePoints(base, bonus) {
  const merged = { ...base };
  for (const [k, v] of Object.entries(bonus)) merged[k] = (merged[k] ?? 0) + v;
  return merged;
}
