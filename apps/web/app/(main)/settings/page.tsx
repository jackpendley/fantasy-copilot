import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PushSettings } from "@/components/push-settings";
import { PageHeader } from "@/components/fc/bits";
import { ThemeToggle } from "@/components/theme-toggle";
import { db, dbConfigured } from "@/lib/db";
import { fmtDayTime } from "@/lib/format";
import { DAILY_CPU_BUDGET_S } from "@/lib/nba/move-sim";

type JobRow = { job: string; status: string; detail: string | null; ran_at: Date };

async function recentJobs() {
  if (!dbConfigured()) return [];
  return db()<JobRow[]>`
    select job, status, detail, ran_at from refresh_log order by ran_at desc limit 8
  `;
}

/** Each job's latest run and latest success. */
async function jobStatus() {
  if (!dbConfigured()) return [];
  return db()<(JobRow & { last_ok: Date | null })[]>`
    select distinct on (job) job, status, detail, ran_at,
      (select max(ran_at) from refresh_log o where o.job = r.job and o.status = 'ok') as last_ok
    from refresh_log r order by job, ran_at desc
  `;
}

const when = (d: Date) => fmtDayTime(d);

/** Simulation CPU seconds by kind over the last 30 days, and move checks' last 24 hours. */
async function simulationCpu() {
  if (!dbConfigured()) return null;
  const rows = await db()<{ job: string; cpu: number | null; day: number | null }[]>`
    select job,
      sum((detail::jsonb->>'cpu')::float) as cpu,
      sum((detail::jsonb->>'cpu')::float) filter (where ran_at > now() - interval '24 hours') as day
    from refresh_log
    where job in ('move-sim', 'outlook-sim', 'trade-sim') and status = 'ok'
      and ran_at > now() - interval '30 days'
    group by job
  `;
  return new Map(rows.map((r) => [r.job, { month: r.cpu ?? 0, day: r.day ?? 0 }]));
}
const minutes = (s: number) => `${(s / 60).toFixed(s < 600 ? 1 : 0)} min`;

/** Vercel CPU of scheduled and background work over the last 24 hours, by job and step. */
async function computeUse() {
  if (!dbConfigured()) return null;
  const [bySource, bySteps, [jobs]] = await Promise.all([
    db()<{ source: string; runs: number; ms: number; unchanged: number; known: number }[]>`
      select source,
        (count(*) + coalesce(sum((detail->'held'->>'runs')::int), 0))::int as runs,
        (sum(cpu_ms) + coalesce(sum((detail->'held'->>'ms')::int), 0))::int as ms,
        count(*) filter (where detail->>'leagueChanged' = 'false')::int as unchanged,
        count(*) filter (where detail->>'leagueChanged' in ('true', 'false'))::int as known
      from cpu_log where ran_at > now() - interval '24 hours'
      group by source order by ms desc
    `,
    db()<{ source: string; step: string; ms: number }[]>`
      select source, step, sum(ms)::int as ms from (
        select source, e.key as step, e.value::int as ms
        from cpu_log, jsonb_each_text(steps) e where ran_at > now() - interval '24 hours'
        union all
        select source, e.key, e.value::int
        from cpu_log, jsonb_each_text(coalesce(detail->'held'->'steps', '{}')) e
        where ran_at > now() - interval '24 hours'
      ) s group by 1, 2 order by 3 desc
    `,
    db()<{ jobs: number; ms: number | null; secs: number | null; moves: number | null }[]>`
      select count(*)::int as jobs, avg(vercel_cpu_ms)::float as ms,
        avg(extract(epoch from updated_at - created_at)) filter (where status = 'done')::float as secs,
        avg(jsonb_array_length(moves))::float as moves
      from sim_jobs where created_at > now() - interval '24 hours'
    `,
  ]);
  return { bySource, bySteps, jobs };
}

export default async function SettingsPage() {
  const [jobs, status, cpu, compute] = await Promise.all([
    recentJobs().catch(() => []),
    jobStatus().catch(() => []),
    simulationCpu().catch(() => null),
    computeUse().catch(() => null),
  ]);
  const cpuOf = (job: string) => cpu?.get(job) ?? { month: 0, day: 0 };
  const cpuTotal = ["move-sim", "outlook-sim", "trade-sim"].reduce((a, j) => a + cpuOf(j).month, 0);
  return (
    <>
      <PageHeader title="Settings" />

      <Link
        href="/nba/model"
        className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 text-sm hover:bg-muted/50"
      >
        <span>
          <span className="font-medium">Model accuracy</span>
          <span className="block text-xs text-muted-foreground">
            How each projection source has done this season, and every pre-registered test
          </span>
        </span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Dark by default. Light, or follow your device.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
          <CardDescription>
            On game days the app checks every 5 minutes and alerts you when a starter is ruled out,
            when your lineup isn&apos;t optimal 30 minutes before tip, when a doubtful starter has a
            later-tipping backup, and if the ESPN login stops working.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PushSettings />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Background jobs</CardTitle>
          <CardDescription>
            Game-day checks run every 5 minutes (cron-job.org) and only log when they do work: a
            roster move, a new DARKO run or the window around games. Nightly and pregame run once a
            day, and each step of the nightly run shows its own latest result.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {status.length === 0 && <p className="text-muted-foreground">No job runs yet.</p>}
          {status.map((j) => (
            <div key={j.job}>
              <div className="flex items-baseline justify-between gap-2">
                <span>{j.job}</span>
                <span className={j.status === "ok" ? "text-muted-foreground" : "text-destructive"}>
                  {j.status === "ok"
                    ? `ok ${when(j.ran_at)}`
                    : `failed ${when(j.ran_at)}${j.last_ok ? ` · last ok ${when(j.last_ok)}` : ""}`}
                </span>
              </div>
              {j.status !== "ok" && j.detail && (
                <p className="text-xs break-words text-muted-foreground">{j.detail}</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      {compute && compute.bySource.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Vercel CPU, last 24 hours</CardTitle>
            <CardDescription>
              Scheduled and background work, by job and step (pages are in Vercel → Observability).
              Hobby allows 240 CPU minutes in any 30 days: 8 a day. Figures can include other work
              running on the same server at the time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm tabular-nums">
            {compute.bySource.map((r) => (
              <div key={r.source}>
                <div className="flex justify-between gap-2 font-medium">
                  <span>{r.source}</span>
                  <span>
                    {minutes(r.ms / 1000)} · {r.runs} runs ·{" "}
                    {Math.round(r.ms / Math.max(1, r.runs))} ms each
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {compute.bySteps
                    .filter((x) => x.source === r.source)
                    .slice(0, 6)
                    .map((x) => `${x.step} ${(x.ms / 1000).toFixed(1)} s`)
                    .join(" · ")}
                  {r.known > 0 &&
                    ` · league unchanged since the last run in ${Math.round((100 * r.unchanged) / r.known)}% of runs`}
                </p>
              </div>
            ))}
            {compute.jobs && compute.jobs.jobs > 0 && (
              <p className="border-t pt-1 text-xs text-muted-foreground">
                {`Simulation jobs: ${compute.jobs.jobs}, ~${Math.round(compute.jobs.moves ?? 0)} moves each; `}
                the worker&apos;s requests cost Vercel {((compute.jobs.ms ?? 0) / 1000).toFixed(1)}{" "}
                s per job
                {compute.jobs.secs != null &&
                  `; done in ${(compute.jobs.secs / 60).toFixed(1)} min on average`}
                .
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {cpu && (
        <Card>
          <CardHeader>
            <CardTitle>Simulation CPU</CardTitle>
            <CardDescription>
              Last 30 days. Vercel Hobby includes 240 CPU minutes a month for everything (pages
              too): Vercel → Usage has the full total. Waiver checks give close calls a second batch
              only while today&apos;s use is under {DAILY_CPU_BUDGET_S / 60} minutes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm tabular-nums">
            {[
              ["Outlook runs", "outlook-sim"],
              ["Waiver move checks", "move-sim"],
              ["Trade simulations", "trade-sim"],
            ].map(([label, job]) => (
              <div key={job} className="flex justify-between gap-2">
                <span>{label}</span>
                <span className="text-muted-foreground">
                  {minutes(cpuOf(job!).month)}
                  {job === "move-sim" && ` · ${minutes(cpuOf(job).day)} today`}
                </span>
              </div>
            ))}
            <div className="flex justify-between gap-2 border-t pt-1 font-medium">
              <span>Total</span>
              <span>{minutes(cpuTotal)}</span>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Recent jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {jobs.length === 0 && <p className="text-muted-foreground">No job runs yet.</p>}
          {jobs.map((j, i) => (
            <div key={i} className="flex gap-2">
              <span className={j.status === "ok" ? "" : "text-destructive"}>{j.job}</span>
              <span className="text-muted-foreground">{when(j.ran_at)}</span>
              <span className="min-w-0 break-all text-muted-foreground">{j.detail}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
