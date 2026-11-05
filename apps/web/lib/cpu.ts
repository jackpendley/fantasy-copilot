import "server-only";
// Vercel CPU per scheduled or background run, split into steps (docs/COMPUTE.md). Hobby
// includes 4 hours of Active CPU in any 30 days, so every recurring job is measured.
//
// process.cpuUsage() covers the whole process, and Fluid compute serves several requests per
// instance: a step's figure includes anything else running at the same moment. It's an upper
// bound, close to exact for the scheduled jobs (nothing else is usually running).

import { db, dbConfigured } from "./db";

const msOf = (u: NodeJS.CpuUsage) => Math.round((u.user + u.system) / 1000);

export class CpuMeter {
  private readonly t0 = process.cpuUsage();
  readonly steps: Record<string, number> = {};

  /** Run `fn`, adding its CPU to step `name` (steps can repeat). */
  async step<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
    const s = process.cpuUsage();
    try {
      return await fn();
    } finally {
      this.steps[name] = (this.steps[name] ?? 0) + msOf(process.cpuUsage(s));
    }
  }

  /** CPU since the meter started (ms). */
  get ms(): number {
    return msOf(process.cpuUsage(this.t0));
  }
}

/** Runs measured but not written yet (they didn't touch the database), per source. */
const held = new Map<string, { runs: number; ms: number; steps: Record<string, number> }>();

/**
 * Store a run's CPU. `hold`: the run otherwise left the database asleep (Neon bills awake
 * time), so it's added to this instance's next stored row for the source instead.
 */
export async function recordCpu(
  source: string,
  m: CpuMeter,
  detail: Record<string, unknown> = {},
  hold = false,
): Promise<void> {
  if (!dbConfigured()) return;
  const ms = m.ms;
  if (hold) {
    const h = held.get(source) ?? { runs: 0, ms: 0, steps: {} };
    h.runs++;
    h.ms += ms;
    for (const [k, v] of Object.entries(m.steps)) h.steps[k] = (h.steps[k] ?? 0) + v;
    held.set(source, h);
    return;
  }
  const h = held.get(source);
  held.delete(source);
  await db()`
    insert into cpu_log (source, cpu_ms, steps, detail)
    values (${source}, ${ms}, ${db().json(m.steps)},
      ${db().json({ ...detail, ...(h ? { held: h } : {}) } as never)})
  `.catch(() => {});
}
