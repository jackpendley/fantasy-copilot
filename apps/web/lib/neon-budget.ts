// Neon's Free limits and our monthly budget (docs/COMPUTE.md §10), and the alerts they raise.
// Pure, so it's tested without the API.

export interface NeonUsage {
  transferBytes: number;
  cuHours: number;
  /** Hours the compute was awake (at any size). */
  activeHours: number;
  periodStart: Date | null;
}

/** Neon Free, per project per month. */
export const FREE = { transferBytes: 5e9, cuHours: 100 };
/** Our budget: room to return to Free (and a small bill on Launch until then). */
export const BUDGET = { transferBytes: 2e9, cuHours: 60 };
/** Alert when a total passes these shares of the Free limit. */
const STEPS = [0.6, 0.85];

/** The billing period's share elapsed (it runs one calendar month from its start). */
export function periodShare(start: Date, now: Date): number {
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return Math.min(
    1,
    Math.max(0, (now.getTime() - start.getTime()) / (end.getTime() - start.getTime())),
  );
}

/** Where the month ends at this pace (null in its first day: too early to tell). */
export function onPace(u: NeonUsage, now: Date): { transferBytes: number; cuHours: number } | null {
  if (!u.periodStart) return null;
  const share = periodShare(u.periodStart, now);
  if (share < 1 / 31) return null;
  return { transferBytes: u.transferBytes / share, cuHours: u.cuHours / share };
}

const gb = (b: number) => `${(b / 1e9).toFixed(2)} GB`;
const cu = (h: number) => `${h.toFixed(1)} CU-hours`;

/**
 * The alerts due now, each with a key unique to its period and threshold (sent once through
 * `sendAlertOnce`): a total past 60% or 85% of the Free limit, or a month on pace past the budget.
 */
export function usageAlerts(
  u: NeonUsage,
  now: Date,
): { key: string; title: string; body: string }[] {
  const period = (u.periodStart ?? now).toISOString().slice(0, 7);
  const out: { key: string; title: string; body: string }[] = [];
  const kinds = [
    ["transfer", "Database transfer", u.transferBytes, FREE.transferBytes, gb],
    ["compute", "Database compute", u.cuHours, FREE.cuHours, cu],
  ] as const;
  for (const [kind, label, used, limit, fmt] of kinds) {
    const step = [...STEPS].reverse().find((s) => used >= s * limit);
    if (step)
      out.push({
        key: `neon:${period}:${kind}:${step}`,
        title: `${label} at ${Math.round((100 * used) / limit)}% of Neon Free`,
        body: `${fmt(used)} of ${fmt(limit)} this month. Settings shows the pace.`,
      });
  }
  const pace = onPace(u, now);
  if (pace) {
    const over = [
      ["transfer", "transfer", pace.transferBytes, BUDGET.transferBytes, gb],
      ["compute", "compute", pace.cuHours, BUDGET.cuHours, cu],
    ] as const;
    for (const [kind, label, projected, budget, fmt] of over)
      if (projected > budget)
        out.push({
          key: `neon:${period}:${kind}:pace`,
          title: `Database ${label} over budget`,
          body: `On pace for ${fmt(projected)} this month; the budget is ${fmt(budget)}.`,
        });
  }
  return out;
}
