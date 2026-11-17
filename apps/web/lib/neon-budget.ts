// Neon's Free limits and our monthly budget (docs/COMPUTE.md §10), and the alerts they raise.
// Pure, so it's tested without the API.

export interface NeonUsage {
  transferBytes: number;
  cuHours: number;
  /** Hours the compute was awake (at any size). */
  activeHours: number;
  periodStart: Date | null;
  /** When the period ends, from Neon (null when it doesn't say). */
  periodEnd: Date | null;
}

/** Neon Free, per project per month. */
export const FREE = { transferBytes: 5e9, cuHours: 100 };
/** Our budget: room to return to Free (and a small bill on Launch until then). */
export const BUDGET = { transferBytes: 2e9, cuHours: 60 };
/** Alert when a total passes these shares of the Free limit. */
const STEPS = [0.6, 0.85];

const DAY = 86_400_000;
/** An average month, so a period cut short by a plan change still compares with monthly limits. */
const MONTH = 30.44 * DAY;

/** Neon bills by calendar month: a period started mid-month (a plan change) ends on the 1st. */
export function periodEnd(u: NeonUsage): Date | null {
  if (u.periodEnd) return u.periodEnd;
  if (!u.periodStart) return null;
  return new Date(Date.UTC(u.periodStart.getUTCFullYear(), u.periodStart.getUTCMonth() + 1, 1));
}

/** A whole month at this period's daily rate (null in its first day: too early to tell). */
export function onPace(u: NeonUsage, now: Date): { transferBytes: number; cuHours: number } | null {
  if (!u.periodStart) return null;
  const elapsed = now.getTime() - u.periodStart.getTime();
  if (elapsed < DAY) return null;
  return {
    transferBytes: (u.transferBytes * MONTH) / elapsed,
    cuHours: (u.cuHours * MONTH) / elapsed,
  };
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
          body: `A month at this rate is ${fmt(projected)}; the budget is ${fmt(budget)}.`,
        });
  }
  const review = planReview(u, now);
  if (review) out.push(review);
  return out;
}

/**
 * In the period's last 36 hours (the nightly and pregame runs before it ends), whether a month
 * at this rate fits Neon Free: the reminder to choose between Launch and Free for the next one.
 */
export function planReview(
  u: NeonUsage,
  now: Date,
): { key: string; title: string; body: string } | null {
  const end = periodEnd(u);
  const pace = onPace(u, now);
  if (!end || !pace || now >= end || end.getTime() - now.getTime() > 1.5 * DAY) return null;
  const fits =
    pace.transferBytes <= FREE.transferBytes * 0.85 && pace.cuHours <= FREE.cuHours * 0.85;
  const day = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
  return {
    key: `neon:${(u.periodStart ?? now).toISOString().slice(0, 7)}:review`,
    title: fits ? "Database fits Neon Free" : "Database still needs Neon Launch",
    body:
      `${day(u.periodStart ?? now)}–${day(end)}: ${gb(u.transferBytes)} and ${cu(u.cuHours)}; ` +
      `a month at this rate is ${gb(pace.transferBytes)} and ${cu(pace.cuHours)} ` +
      `(Free: ${gb(FREE.transferBytes)}, ${cu(FREE.cuHours)}). ` +
      (fits
        ? "To switch: Vercel → Storage → the database → Settings → Change Configuration → Free."
        : "Staying on Launch costs about $0.106 per CU-hour."),
  };
}
