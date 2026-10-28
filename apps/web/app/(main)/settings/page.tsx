import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PushSettings } from "@/components/push-settings";
import { PageHeader } from "@/components/fc/bits";
import { ThemeToggle } from "@/components/theme-toggle";
import { db, dbConfigured } from "@/lib/db";
import { fmtTip } from "@/lib/format";

async function recentJobs() {
  if (!dbConfigured()) return [];
  return db()<{ job: string; status: string; detail: string | null; ran_at: Date }[]>`
    select job, status, detail, ran_at from refresh_log order by ran_at desc limit 8
  `;
}

export default async function SettingsPage() {
  const jobs = await recentJobs().catch(() => []);
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
          <CardTitle>Recent jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {jobs.length === 0 && <p className="text-muted-foreground">No job runs yet.</p>}
          {jobs.map((j, i) => (
            <div key={i} className="flex gap-2">
              <span className={j.status === "ok" ? "" : "text-destructive"}>{j.job}</span>
              <span className="text-muted-foreground">
                {j.ran_at.toISOString().slice(5, 10)} {fmtTip(j.ran_at.toISOString())}
              </span>
              <span className="truncate text-muted-foreground">{j.detail}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
