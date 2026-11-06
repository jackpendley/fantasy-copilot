"use client";

// Two players side by side (the add and the drop of a move): projections, this season's
// numbers, where their fantasy points come from and every advanced stat with its league
// percentile. The better of the two is green. Data is the player cards' (cached the same way).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtPts } from "@/lib/display";
import { winner, type Row, startsLabel } from "@/lib/compare";
import { METRICS } from "@/lib/nba/pbp-metrics";
import type { PlayerCardData } from "@/lib/nba/player-card";
import { cn } from "@/lib/utils";
import { usePlayerCard } from "./player-card";
import { PercentileBadge } from "./percentile";
import { PlayerAvatar } from "./player-avatar";
import { StatusPill } from "./status-pill";

const BETTER = new Map(METRICS.map((m) => [m.key, m.better]));
const BOX = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TO", "FG%", "FT%"];

const num = (v: number | null | undefined, f: (x: number) => string = fmtPts) =>
  v == null ? null : f(v);

function sections(a: PlayerCardData, b: PlayerCardData) {
  const sa = a.seasons.current.split;
  const sb = b.seasons.current.split;
  const proj: Row[] = [
    {
      label: "Projection (FP/G)",
      a: num(a.projection.best),
      b: num(b.projection.best),
      av: a.projection.best,
      bv: b.projection.best,
      better: "high",
    },
    {
      label: "DARKO (FP/G)",
      a: num(a.darko?.fppg),
      b: num(b.darko?.fppg),
      av: a.darko?.fppg,
      bv: b.darko?.fppg,
      better: "high",
    },
    {
      label: "Projected minutes",
      a: num(a.projection.minutes ?? a.darko?.minutes, (x) => x.toFixed(1)),
      b: num(b.projection.minutes ?? b.darko?.minutes, (x) => x.toFixed(1)),
      av: a.projection.minutes ?? a.darko?.minutes,
      bv: b.projection.minutes ?? b.darko?.minutes,
      better: "high",
    },
    {
      label: "Games left",
      a: String(a.rest.gamesLeft),
      b: String(b.rest.gamesLeft),
      av: a.rest.gamesLeft,
      bv: b.rest.gamesLeft,
      better: "high",
    },
    {
      label: "Starts for you",
      a: startsLabel(a),
      b: startsLabel(b),
      av: a.rest.starts?.starts,
      bv: b.rest.starts?.starts,
      better: "high",
    },
    {
      label: "Rest-of-season points",
      a: num(a.rest.projectedPoints, (x) => String(Math.round(x))),
      b: num(b.rest.projectedPoints, (x) => String(Math.round(x))),
      av: a.rest.projectedPoints,
      bv: b.rest.projectedPoints,
      better: "high",
    },
    {
      label: "Rostered (ESPN)",
      a: num(a.rest.owned, (x) => `${x.toFixed(0)}%`),
      b: num(b.rest.owned, (x) => `${x.toFixed(0)}%`),
    },
  ];
  const season: Row[] = [
    {
      label: "FP/G",
      a: num(sa?.fppg),
      b: num(sb?.fppg),
      av: sa?.fppg,
      bv: sb?.fppg,
      better: "high",
      ap: a.seasons.current.fppgPercentile,
      bp: b.seasons.current.fppgPercentile,
    },
    {
      label: "Last 5 games",
      a: num(a.form.last5),
      b: num(b.form.last5),
      av: a.form.last5,
      bv: b.form.last5,
      better: "high",
    },
    { label: "Games", a: num(sa?.games, String), b: num(sb?.games, String) },
    {
      label: "Minutes",
      a: num(sa?.minutes, (x) => x.toFixed(1)),
      b: num(sb?.minutes, (x) => x.toFixed(1)),
      av: sa?.minutes,
      bv: sb?.minutes,
      better: "high",
    },
    {
      label: "Minutes, last 5",
      a: num(a.form.minutesLast5, (x) => x.toFixed(1)),
      b: num(b.form.minutesLast5, (x) => x.toFixed(1)),
      av: a.form.minutesLast5,
      bv: b.form.minutesLast5,
      better: "high",
    },
    {
      label: "Per 36 min",
      a: num(sa?.per36),
      b: num(sb?.per36),
      av: sa?.per36,
      bv: sb?.per36,
      better: "high",
    },
    {
      label: "Typical range",
      a: sa ? `${fmtPts(sa.floor)}–${fmtPts(sa.ceiling)}` : null,
      b: sb ? `${fmtPts(sb.floor)}–${fmtPts(sb.ceiling)}` : null,
      av: sa?.floor,
      bv: sb?.floor,
      better: "high",
    },
    {
      label: "Swing (game to game)",
      a: num(sa?.sd, (x) => `±${x.toFixed(1)}`),
      b: num(sb?.sd, (x) => `±${x.toFixed(1)}`),
      av: sa?.sd,
      bv: sb?.sd,
      better: "low",
    },
  ];
  const box: Row[] = BOX.map((k) => {
    const pctStat = k.endsWith("%");
    const f = (x: number) => (pctStat ? `${(x * 100).toFixed(1)}%` : x.toFixed(1));
    return {
      label: k,
      a: num(sa?.box[k], f),
      b: num(sb?.box[k], f),
      av: sa?.box[k],
      bv: sb?.box[k],
      better: k === "TO" ? "low" : "high",
    };
  });
  // Fantasy points per game by stat, in the order of the add's biggest sources.
  const stats = [
    ...new Set([...a.contributions.map((c) => c.stat), ...b.contributions.map((c) => c.stat)]),
  ];
  const points: Row[] = stats.map((stat) => {
    const ca = a.contributions.find((c) => c.stat === stat);
    const cb = b.contributions.find((c) => c.stat === stat);
    const f = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;
    return {
      label: stat === "FG" || stat === "FT" ? `${stat} (net)` : stat,
      a: num(ca?.points, f),
      b: num(cb?.points, f),
      av: ca?.points,
      bv: cb?.points,
      better: "high",
    };
  });
  // Advanced stats in the metrics' order; compared by percentile (oriented: higher is better).
  const ma = new Map((a.seasons.current.pbp?.metrics ?? []).map((m) => [m.key, m]));
  const mb = new Map((b.seasons.current.pbp?.metrics ?? []).map((m) => [m.key, m]));
  const advanced = METRICS.filter((m) => ma.has(m.key) || mb.has(m.key)).map((m) => {
    const x = ma.get(m.key);
    const y = mb.get(m.key);
    return {
      group: m.group,
      row: {
        label: m.label,
        a: x?.value ?? null,
        b: y?.value ?? null,
        av: x?.percentile,
        bv: y?.percentile,
        better: BETTER.get(m.key) ? ("high" as const) : null,
        ap: x?.percentile,
        bp: y?.percentile,
      },
    };
  });
  return { proj, season, box, points, advanced };
}

function Rows({ title, aside, rows }: { title: string; aside?: string; rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <section className="space-y-1 border-t px-4 py-3 sm:px-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {aside && <span className="text-[11px] text-muted-foreground">{aside}</span>}
      </div>
      {rows.map((r) => {
        const w = winner(r);
        const cell = (v: string | null, p: number | null | undefined, wins: boolean) => (
          <span className="flex items-center justify-end gap-1 tabular-nums">
            <span className={cn(wins ? "font-semibold text-success" : "text-foreground")}>
              {v ?? "—"}
            </span>
            {p != null && <PercentileBadge p={p} colored={r.better != null} />}
          </span>
        );
        return (
          <div
            key={r.label}
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,6.5rem)_minmax(0,6.5rem)] items-center gap-2 py-0.5 text-xs"
          >
            <span className="text-muted-foreground">{r.label}</span>
            {cell(r.a, r.ap, w === "a")}
            {cell(r.b, r.bp, w === "b")}
          </div>
        );
      })}
    </section>
  );
}

function Header({ a, b }: { a: PlayerCardData; b: PlayerCardData }) {
  const who = (p: PlayerCardData, sign: "+" | "−") => (
    <div className="flex min-w-0 flex-col items-end gap-1 text-right">
      <PlayerAvatar id={p.id} name={p.name} size={36} />
      <div className="text-xs font-semibold break-words">
        <span className={sign === "+" ? "text-success" : "text-danger"}>{sign}</span> {p.name}
      </div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {p.proTeam} · {p.positions.join("/")}
        <StatusPill status={p.status} short />
      </div>
    </div>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,6.5rem)_minmax(0,6.5rem)] items-end gap-2 px-4 pt-5 pb-3 sm:px-5">
      <div>
        <DialogTitle className="text-base">Compare</DialogTitle>
        <DialogDescription className="text-[11px]">Green: the better of the two</DialogDescription>
      </div>
      {who(a, "+")}
      {who(b, "−")}
    </div>
  );
}

function Body({ a, b }: { a: PlayerCardData; b: PlayerCardData }) {
  const s = sections(a, b);
  const groups = [...new Set(s.advanced.map((x) => x.group))];
  const label = a.seasons.current.label;
  return (
    <>
      <Header a={a} b={b} />
      <Rows title="Rest of season" rows={s.proj} />
      <Rows title="This season" aside={label} rows={s.season} />
      <Rows title="Per game" aside={label} rows={s.box} />
      <Rows title="Fantasy points by stat" aside="per game" rows={s.points} />
      {groups.map((g, i) => (
        <Rows
          key={g}
          title={g}
          aside={i === 0 ? "Advanced · league percentile among regulars" : undefined}
          rows={s.advanced.filter((x) => x.group === g).map((x) => x.row)}
        />
      ))}
      <p className="border-t px-4 py-3 text-[11px] text-muted-foreground sm:px-5">
        Percentiles: green 80th or better, red 20th or worse; style stats (like 3-point rate)
        aren&apos;t good or bad, so they stay grey and pick no winner. The season sim runs on the
        projections above: a role change still to come (a teammate returning, a new starter) only
        shows up once the projections or the minutes move.
      </p>
    </>
  );
}

/** "Compare" button that opens the add and the drop side by side. */
export function ComparePlayers({ addId, dropId }: { addId: number; dropId: number }) {
  const card = usePlayerCard();
  const [open, setOpen] = useState(false);
  const [pair, setPair] = useState<[PlayerCardData, PlayerCardData] | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!card) return null;

  const show = () => {
    setOpen(true);
    setError(null);
    if (pair && pair[0].id === addId && pair[1].id === dropId) return;
    setPair(null);
    Promise.all([card.load(addId), card.load(dropId)])
      .then(([a, b]) => setPair([a, b]))
      .catch((e: Error) => setError(e.message));
  };
  const ready = pair && pair[0].id === addId && pair[1].id === dropId ? pair : null;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={show}
        onMouseEnter={() => {
          card.prefetch(addId);
          card.prefetch(dropId);
        }}
      >
        Compare
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            "h-[min(88dvh,780px)] grid-cols-[minmax(0,1fr)] content-start gap-0 overflow-y-auto p-0 sm:max-w-xl",
            "max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none",
          )}
        >
          {ready ? (
            <Body a={ready[0]} b={ready[1]} />
          ) : error ? (
            <div className="p-6">
              <DialogTitle>Couldn&apos;t load these players</DialogTitle>
              <DialogDescription className="mt-2">{error}</DialogDescription>
            </div>
          ) : (
            <div className="space-y-3 p-5">
              <DialogTitle className="sr-only">Compare</DialogTitle>
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-40 rounded-lg" />
              <Skeleton className="h-40 rounded-lg" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
