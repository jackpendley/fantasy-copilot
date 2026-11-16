import "server-only";
// The database's usage this billing period (docs/COMPUTE.md §10), from Neon's API: network
// transfer and compute, against Neon's Free limits and our budget. Settings shows it; the
// nightly and pregame jobs push an alert as either one nears a limit. Needs NEON_API_KEY (a
// project-scoped key, Production only) and the project id the Vercel integration sets.

import { usageAlerts, type NeonUsage } from "./neon-budget";
import { sendAlertOnce } from "./push";

export { usageAlerts, type NeonUsage };

export const neonConfigured = () =>
  Boolean(process.env.NEON_API_KEY && process.env.DATABASE_NEON_PROJECT_ID);

/** This period's usage; null without a key or when Neon doesn't answer. */
export async function neonUsage(): Promise<NeonUsage | null> {
  if (!neonConfigured()) return null;
  const res = await fetch(
    `https://console.neon.tech/api/v2/projects/${process.env.DATABASE_NEON_PROJECT_ID}`,
    {
      headers: { Authorization: `Bearer ${process.env.NEON_API_KEY}`, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    },
  );
  if (!res.ok) throw new Error(`Neon API ${res.status}`);
  const { project: p } = (await res.json()) as {
    project: {
      data_transfer_bytes?: number;
      compute_time_seconds?: number;
      active_time_seconds?: number;
      consumption_period_start?: string;
    };
  };
  return {
    transferBytes: p.data_transfer_bytes ?? 0,
    // Compute seconds are CU-seconds: a second at 0.25 CU counts 0.25.
    cuHours: (p.compute_time_seconds ?? 0) / 3600,
    activeHours: (p.active_time_seconds ?? 0) / 3600,
    periodStart: p.consumption_period_start ? new Date(p.consumption_period_start) : null,
  };
}

/** Push any usage alert due (each once per period and threshold); the totals, for the job log. */
export async function checkNeonUsage(now = new Date()) {
  const u = await neonUsage();
  if (!u) return null;
  let alerts = 0;
  for (const a of usageAlerts(u, now))
    if (await sendAlertOnce(a.key, { title: a.title, body: a.body, url: "/settings" })) alerts++;
  return {
    transferGB: +(u.transferBytes / 1e9).toFixed(3),
    cuHours: +u.cuHours.toFixed(2),
    alerts,
  };
}
