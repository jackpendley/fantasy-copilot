import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { PageHeader, SectionTitle } from "@/components/fc/bits";
import { Button } from "@/components/ui/button";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { SetupError } from "@/lib/env";
import { fmtPts } from "@/lib/format";
import { loadLeagueView } from "@/lib/nba/league-view";
import { cn } from "@/lib/utils";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default async function LeaguePage() {
  let v;
  try {
    v = await loadLeagueView();
  } catch (e) {
    if (e instanceof SetupError) return <SetupNotice message={e.message} />;
    return <ErrorNotice title="Couldn't load the league" message={(e as Error).message} />;
  }
  const standings = [...v.teams].sort(
    (a, b) =>
      b.team.wins - a.team.wins || b.team.pointsFor - a.team.pointsFor || b.perWeek - a.perWeek,
  );
  const hasOdds = v.teams.some((t) => t.odds);

  return (
    <>
      <PageHeader title="League" subtitle={`${v.teams.length} teams · standings and strength`}>
        <Button asChild size="sm">
          <Link href="/nba/league/trades">
            <ArrowLeftRight className="size-4" /> Trades
          </Link>
        </Button>
      </PageHeader>

      <section className="space-y-1.5">
        <SectionTitle aside={hasOdds ? "Odds from the latest outlook run" : undefined}>
          Standings
        </SectionTitle>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-medium">Team</th>
                <th className="px-2 py-2.5 text-right font-medium whitespace-nowrap">W-L</th>
                <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">PF</th>
                <th
                  className="px-2 py-2.5 text-right font-medium"
                  title="Projected starting-lineup points per week for the rest of the regular season"
                >
                  Pts/wk
                </th>
                <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">Power</th>
                {hasOdds && (
                  <>
                    <th className="hidden px-2 py-2.5 text-right font-medium sm:table-cell">
                      Playoffs
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">Title</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {standings.map((t, i) => (
                <tr key={t.team.id} className={cn(t.mine && "bg-primary/5")}>
                  <td className="px-3 py-2">
                    <Link
                      href={`/nba/league/${t.team.id}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <span className="w-4 text-right text-xs text-muted-foreground">{i + 1}</span>
                      <span
                        className={cn(
                          "max-w-32 truncate sm:max-w-none",
                          t.mine && "font-semibold text-primary",
                        )}
                      >
                        {t.team.name}
                      </span>
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right">
                    {t.team.wins}-{t.team.losses}
                  </td>
                  <td className="hidden px-2 py-2 text-right text-muted-foreground sm:table-cell">
                    {Math.round(t.team.pointsFor)}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold">{Math.round(t.perWeek)}</td>
                  <td className="hidden px-2 py-2 text-right text-muted-foreground sm:table-cell">
                    #{v.power.get(t.team.id)}
                  </td>
                  {hasOdds && (
                    <>
                      <td className="hidden px-2 py-2 text-right sm:table-cell">
                        {t.odds ? pct(t.odds.playoffs) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {t.odds ? pct(t.odds.champ) : "—"}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          Pts/wk = projected starting-lineup points per regular-season week from today: each
          day&apos;s best lineup from the players with a game. Power ranks teams by it.
          {hasOdds && " Playoff and title odds come from the nightly season simulation."} Average
          strength: {fmtPts(v.teams.reduce((a, t) => a + t.perWeek, 0) / v.teams.length)} pts/wk.
        </p>
      </section>
    </>
  );
}
