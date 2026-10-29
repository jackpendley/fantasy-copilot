import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PushSettings } from "@/components/push-settings";
import { PageHeader } from "@/components/fc/bits";
import { ThemeToggle } from "@/components/theme-toggle";
import { db, dbConfigured } from "@/lib/db";
import { fmtTip } from "@/lib/format";

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

const when = (d: Date) => `${d.toISOString().slice(5, 10)} ${fmtTip(d.toISOString())}`;

export default async function SettingsPage() {
  const [jobs, status] = await Promise.all([
    recentJobs().catch(() => []),
    jobStatus().catch(() => []),
  ]);
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
            roster move or the window around games. Nightly and pregame run once a day.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {status.length === 0 && <p className="text-muted-foreground">No job runs yet.</p>}
          {status.map((j) => (
            <div key={j.job} className="flex items-baseline justify-between gap-2">
              <span>{j.job}</span>
              <span className={j.status === "ok" ? "text-muted-foreground" : "text-destructive"}>
                {j.status === "ok"
                  ? `ok ${when(j.ran_at)}`
                  : `failed ${when(j.ran_at)}${j.last_ok ? ` · last ok ${when(j.last_ok)}` : ""}`}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
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
              <span className="truncate text-muted-foreground">{j.detail}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
