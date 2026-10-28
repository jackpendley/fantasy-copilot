import Link from "next/link";
import { IlPlanNote } from "@/components/fc/il-plan-note";
import { notFound } from "next/navigation";
import { ArrowLeftRight, ChevronLeft } from "lucide-react";
import { PageHeader, SlotChip, StatTile } from "@/components/fc/bits";
import { PlayerAvatar } from "@/components/fc/player-avatar";
import { StatusPill } from "@/components/fc/status-pill";
import { TeamLogo } from "@/components/fc/team-logo";
import { Button } from "@/components/ui/button";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { SetupError } from "@/lib/env";
import { fmtPts } from "@/lib/format";
import { loadLeagueView } from "@/lib/nba/league-view";
import { perGameProjection } from "@/lib/nba/projection";
import { rawValue } from "@/lib/nba/trade";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  let v;
  try {
    v = await loadLeagueView();
  } catch (e) {
    if (e instanceof SetupError) return <SetupNotice message={e.message} />;
    return <ErrorNotice title="Couldn't load the league" message={(e as Error).message} />;
  }
  const t = v.teams.find((x) => x.team.id === id);
  if (!t) notFound();
  const roster = [...t.team.roster].sort(
    (a, b) => perGameProjection(b).fppg - perGameProjection(a).fppg,
  );

  return (
    <>
      <Link
        href="/nba/league"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> League
      </Link>
      <PageHeader
        title={t.team.name}
        subtitle={`${t.mine ? "Your team · " : ""}${t.team.wins}-${t.team.losses} · ${Math.round(t.team.pointsFor)} PF`}
      >
        {!t.mine && (
          <Button asChild size="sm">
            <Link href={`/nba/league/trades?team=${t.team.id}`}>
              <ArrowLeftRight className="size-4" /> Trade
            </Link>
          </Button>
        )}
      </PageHeader>

      <IlPlanNote
        who={t.mine ? "you'd" : "they'd"}
        plan={t.value.activations
          .filter((a) => v.injured.has(a.player.id))
          .map((a) => ({ ...a, absence: v.injured.get(a.player.id)! }))}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="Pts/wk"
          value={Math.round(t.perWeek)}
          sub={`Power #${v.power.get(t.team.id)}`}
        />
        <StatTile
          label="Playoff weeks"
          value={Math.round(t.value.playoffs)}
          sub="projected starting pts"
        />
        <StatTile label="Playoffs" value={t.odds ? pct(t.odds.playoffs) : "—"} />
        <StatTile label="Title" value={t.odds ? pct(t.odds.champ) : "—"} />
      </div>

      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {roster.map((p) => (
          <Link
            key={p.id}
            href={`/nba/players/${p.id}`}
            className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/50"
          >
            <div className="w-10 shrink-0 text-center">
              <SlotChip slot={p.slot ?? "BE"} />
            </div>
            <PlayerAvatar id={p.id} name={p.name} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium">{p.name}</span>
                <StatusPill status={p.injuryStatus ?? "ACTIVE"} />
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <TeamLogo abbr={p.proTeam} size={12} />
                {p.positions.join("/")}
              </div>
            </div>
            <div className="shrink-0 text-right tabular-nums">
              <div className="font-semibold">{fmtPts(perGameProjection(p).fppg)}</div>
              <div className="text-[11px] text-muted-foreground">
                {Math.round(rawValue([p], v.ctx))} season
              </div>
            </div>
          </Link>
        ))}
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        Right column: projected FP/G, and projected points over his remaining games (discounted for
        games he&apos;s expected to miss).
      </p>
    </>
  );
}
