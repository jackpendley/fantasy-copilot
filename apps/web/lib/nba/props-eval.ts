// The pre-registered props test (MODEL_CARD.md): our projection vs the props-implied one vs a
// blend, on games actually played. Walk-forward: the blend weight is chosen on the first half
// of the game days and judged on the second half. Pure; /api/model/props feeds it.

export interface EvalRow {
  playerId: number;
  /** ET game day, "2026-10-21". */
  day: string;
  model: number;
  vegas: number;
  actual: number;
}

export interface Comparison {
  mae: number;
  /** Per-player mean error difference vs our model, with a 95% interval (negative = better). */
  vsModel: { mean: number; lo: number; hi: number } | null;
}

export interface PropsEvaluation {
  games: number;
  players: number;
  days: number;
  /** Blend weight on Vegas, fitted on the first half of the days. */
  weight: number;
  /** Judged on the second half of the days. */
  test: { games: number; model: Comparison; vegas: Comparison; blend: Comparison };
  /** True when the pre-registered rule says the blend ships. */
  ships: boolean;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function compare(rows: EvalRow[], predict: (r: EvalRow) => number): Comparison {
  const err = (r: EvalRow) => Math.abs(predict(r) - r.actual);
  const byPlayer = new Map<number, number[]>();
  for (const r of rows) {
    if (!byPlayer.has(r.playerId)) byPlayer.set(r.playerId, []);
    byPlayer.get(r.playerId)!.push(err(r) - Math.abs(r.model - r.actual));
  }
  const diffs = [...byPlayer.values()].map(mean);
  let vsModel: Comparison["vsModel"] = null;
  if (diffs.length > 1) {
    const m = mean(diffs);
    const sd = Math.sqrt(diffs.reduce((a, d) => a + (d - m) ** 2, 0) / (diffs.length - 1));
    const half = (1.96 * sd) / Math.sqrt(diffs.length);
    vsModel = { mean: m, lo: m - half, hi: m + half };
  }
  return { mae: mean(rows.map(err)), vsModel };
}

/** Null until there are at least `minDays` game days and `minGames` games (the registered bar). */
export function evaluateProps(
  rows: EvalRow[],
  { minDays = 7, minGames = 800 } = {},
): PropsEvaluation | null {
  const days = [...new Set(rows.map((r) => r.day))].sort();
  if (days.length < minDays || rows.length < minGames) return null;
  const cut = days[Math.floor(days.length / 2)]!;
  const train = rows.filter((r) => r.day < cut);
  const test = rows.filter((r) => r.day >= cut);
  const blendAt = (w: number) => (r: EvalRow) => (1 - w) * r.model + w * r.vegas;
  let weight = 0;
  let best = Infinity;
  for (let i = 0; i <= 10; i++) {
    const w = i / 10;
    const mae = mean(train.map((r) => Math.abs(blendAt(w)(r) - r.actual)));
    if (mae < best) {
      best = mae;
      weight = w;
    }
  }
  const blend = compare(test, blendAt(weight));
  return {
    games: rows.length,
    players: new Set(rows.map((r) => r.playerId)).size,
    days: days.length,
    weight,
    test: {
      games: test.length,
      model: compare(test, (r) => r.model),
      vegas: compare(test, (r) => r.vegas),
      blend,
    },
    ships: weight > 0 && blend.vsModel != null && blend.vsModel.hi < 0,
  };
}
