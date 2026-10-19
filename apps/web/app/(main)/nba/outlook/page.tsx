import { PageHeader, ProbBar, SectionTitle, StatTile } from "@/components/fc/bits";
import { OddsChart } from "@/components/odds-chart";
import { RunOutlook } from "@/components/run-outlook";
import { ErrorNotice } from "@/components/setup-notice";
import { dbConfigured } from "@/lib/db";
import { fmtTip } from "@/lib/format";
import { dateForScoringPeriod, shortDay } from "@/lib/nba/calendar";
import { latestOutlooks, outlookHistory, type OutlookTeam } from "@/lib/nba/outlook-run";
import { cn } from "@/lib/utils";

const pct = (v: number) => (v < 0.005 && v > 0 ? "<1%" : `${Math.round(v * 100)}%`);

/** Change in percentage points since the previous run; hidden when under half a point. */
function delta(now: number, before: number | undefined) {
  if (before == null) return null;
  const d = Math.round((now - before) * 100);
  if (d === 0) return null;
  return { text: `${d > 0 ? "+" : ""}${d}`, up: d > 0 };
}

export default async function OutlookPage() {
  if (!dbConfigured()) {
    return <ErrorNotice title="Outlook needs the database" message="Set DATABASE_URL." />;
  }
  const myId = Number(process.env.ESPN_TEAM_ID);
  const [runs, history] = await Promise.all([latestOutlooks(), outlookHistory(myId)]);
  const [latest, previous] = runs;
  const me = latest?.results.find((t) => t.teamId === myId);
  const before = previous?.results.find((t) => t.teamId === myId);

  return (
    <>
      <PageHeader
        title="Season outlook"
        subtitle={
          latest
            ? `${latest.seasons} simulated seasons from ${shortDay(dateForScoringPeriod(latest.scoring_period))} · updated ${latest.run_at.toISOString().slice(5, 10).replace("-", "/")} ${fmtTip(latest.run_at.toISOString())}`
            : "No simulation yet. Run one to get your odds."
        }
      >
        <RunOutlook />
      </PageHeader>

      {me && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Title"
            value={pct(me.champ)}
            delta={delta(me.champ, before?.champ)}
            sub={`Final ${pct(me.final)}`}
          />
          <StatTile label="#1 seed" value={pct(me.seed1)} delta={delta(me.seed1, before?.seed1)} />
          <StatTile
            label="Playoffs"
            value={pct(me.playoffs)}
            delta={delta(me.playoffs, before?.playoffs)}
            sub="Top 6 of 12"
          />
          <StatTile
            label="Expected wins"
            value={me.expWins.toFixed(1)}
            sub={`${me.wins}-${me.losses} so far`}
          />
        </div>
      )}

      {history.length > 1 && (
        <section className="space-y-1.5">
          <SectionTitle>Your odds over time</SectionTitle>
          <div className="rounded-xl border bg-card p-3 sm:p-4">
            <OddsChart points={history} />
          </div>
        </section>
      )}

      {latest && (
        <section className="space-y-1.5">
          <SectionTitle aside="Active = share of days the manager sets a lineup">
            League
          </SectionTitle>

          {/* Phones: ranked cards. */}
          <div className="divide-y overflow-hidden rounded-xl border bg-card md:hidden">
            {latest.results.map((t, i) => (
              <TeamCard key={t.teamId} t={t} rank={i + 1} mine={t.teamId === myId} />
            ))}
          </div>

          {/* Desktop: table with inline odds bars. */}
          <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="w-10 px-3 py-2.5 text-left font-medium">#</th>
                  <th className="px-3 py-2.5 text-left font-medium">Team</th>
                  <th className="px-3 py-2.5 text-right font-medium">Record</th>
                  <th className="px-3 py-2.5 text-right font-medium">Exp. W</th>
                  <th className="w-40 px-3 py-2.5 text-left font-medium">Playoffs</th>
                  <th className="px-3 py-2.5 text-right font-medium">#1</th>
                  <th className="px-3 py-2.5 text-right font-medium">Final</th>
                  <th className="w-40 px-3 py-2.5 text-left font-medium">Title</th>
                  <th className="px-3 py-2.5 text-right font-medium">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {latest.results.map((t, i) => (
                  <tr key={t.teamId} className={cn(t.teamId === myId && "bg-primary/5")}>
                    <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td
                      className={cn(
                        "max-w-56 truncate px-3 py-2.5",
                        t.teamId === myId && "font-semibold",
                      )}
                    >
                      {t.name}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {t.wins}-{t.losses}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{t.expWins.toFixed(1)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <ProbBar value={t.playoffs} tone="info" />
                        <span className="w-9 text-right tabular-nums">{pct(t.playoffs)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{pct(t.seed1)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{pct(t.final)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <ProbBar
                          value={t.champ / Math.max(...latest.results.map((r) => r.champ))}
                        />
                        <span className="w-9 text-right font-semibold tabular-nums">
                          {pct(t.champ)}
                        </span>
                      </div>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right tabular-nums",
                        t.act < 0.4 ? "text-danger" : "text-muted-foreground",
                      )}
                    >
                      {Math.round(t.act * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="px-1 text-xs text-muted-foreground">
        Monte Carlo of the rest of the season on the real NBA and league schedules: daily lineups,
        streaky injuries, form swings, and each manager&apos;s lineup and waiver habits (this season
        blended with last season&apos;s for returning owners). 6-team playoffs in weeks 20-22;
        completed weeks keep their real results. Title bars are scaled to the favorite.
      </p>
    </>
  );
}

function TeamCard({ t, rank, mine }: { t: OutlookTeam; rank: number; mine: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 px-3 py-3", mine && "bg-primary/5")}>
      <span className="w-5 text-center text-sm text-muted-foreground tabular-nums">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm", mine && "font-semibold")}>{t.name}</div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
          <span>
            {t.wins}-{t.losses}
          </span>
          <span>·</span>
          <span>{t.expWins.toFixed(1)} exp W</span>
          <span>·</span>
          <span>PO {pct(t.playoffs)}</span>
          <span className={cn(t.act < 0.4 && "text-danger")}>
            · {Math.round(t.act * 100)}% active
          </span>
        </div>
        <ProbBar value={t.playoffs} tone="info" className="mt-1.5" />
      </div>
      <div className="w-14 text-right">
        <div className="text-lg font-semibold tabular-nums">{pct(t.champ)}</div>
        <div className="text-[10px] text-muted-foreground">title</div>
      </div>
    </div>
  );
}
