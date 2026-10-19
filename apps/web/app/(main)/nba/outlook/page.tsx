import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OddsChart } from "@/components/odds-chart";
import { RunOutlook } from "@/components/run-outlook";
import { ErrorNotice } from "@/components/setup-notice";
import { dbConfigured } from "@/lib/db";
import { fmtTip } from "@/lib/format";
import { dateForScoringPeriod, shortDay } from "@/lib/nba/calendar";
import { latestOutlook, outlookHistory } from "@/lib/nba/outlook-run";

const pct = (v: number) => (v < 0.005 && v > 0 ? "<1%" : `${Math.round(v * 100)}%`);

export default async function OutlookPage() {
  if (!dbConfigured()) {
    return <ErrorNotice title="Outlook needs the database" message="Set DATABASE_URL." />;
  }
  const myId = Number(process.env.ESPN_TEAM_ID);
  const [latest, history] = await Promise.all([latestOutlook(), outlookHistory(myId)]);
  const me = latest?.results.find((t) => t.teamId === myId);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Season outlook</h1>
          <p className="text-sm text-muted-foreground">
            {latest
              ? `Simulated ${latest.seasons} seasons from ${shortDay(dateForScoringPeriod(latest.scoring_period))} · updated ${latest.run_at.toISOString().slice(5, 10)} ${fmtTip(latest.run_at.toISOString())}`
              : "No simulation yet."}
          </p>
        </div>
        <RunOutlook />
      </div>

      {me && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap gap-x-6 gap-y-1">
              <span>Title {pct(me.champ)}</span>
              <span>#1 seed {pct(me.seed1)}</span>
              <span>Playoffs {pct(me.playoffs)}</span>
            </CardTitle>
            <CardDescription>
              {me.wins}-{me.losses} so far · {me.expWins.toFixed(1)} expected wins
            </CardDescription>
          </CardHeader>
          {history.length > 1 && (
            <CardContent>
              <OddsChart points={history} />
            </CardContent>
          )}
        </Card>
      )}

      {latest && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead className="text-right">Record</TableHead>
                <TableHead className="text-right">Exp. W</TableHead>
                <TableHead className="text-right">Playoffs</TableHead>
                <TableHead className="text-right">#1</TableHead>
                <TableHead className="text-right">Final</TableHead>
                <TableHead className="text-right">Title</TableHead>
                <TableHead
                  className="text-right"
                  title="Share of days the manager sets a lineup (from ESPN's move counts)"
                >
                  Active
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {latest.results.map((t) => (
                <TableRow
                  key={t.teamId}
                  className={t.teamId === myId ? "bg-primary/5 font-medium" : ""}
                >
                  <TableCell className="max-w-48 truncate">{t.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.wins}-{t.losses}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{t.expWins.toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(t.playoffs)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(t.seed1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(t.final)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(t.champ)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {Math.round(t.act * 100)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Monte Carlo of the rest of the season on the real NBA and league schedules: daily lineups,
        streaky injuries, form swings, each manager&apos;s lineup and waiver activity (this season
        blended with last season&apos;s for returning owners), 6-team playoffs in weeks 20-22.
        Completed weeks keep their actual results. Projections are ESPN&apos;s, blended toward this
        season&apos;s averages; the ML projections replace them in phase 6.
      </p>
    </>
  );
}
