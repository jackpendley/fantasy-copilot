"use client";

// Player card: tap any player row for everything we know and project about him. Data loads
// on open (prefetched on hover) from /api/players/[id]/card and is cached for the visit.

import { createContext, useCallback, useContext, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtPts } from "@/lib/display";
import type { PlayerCardData } from "@/lib/nba/player-card";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "./player-avatar";
import { Pill, StatusPill } from "./status-pill";
import { TeamLogo } from "./team-logo";

interface CardApi {
  open: (id: number) => void;
  prefetch: (id: number) => void;
}

const CardContext = createContext<CardApi | null>(null);

export function PlayerCardProvider({ children }: { children: React.ReactNode }) {
  const cache = useRef(new Map<number, Promise<PlayerCardData>>());
  const current = useRef<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [card, setCard] = useState<PlayerCardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((id: number) => {
    let p = cache.current.get(id);
    if (!p) {
      p = fetch(`/api/players/${id}/card`).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
        return r.json() as Promise<PlayerCardData>;
      });
      cache.current.set(id, p);
      p.catch(() => cache.current.delete(id));
    }
    return p;
  }, []);

  const open = useCallback(
    (id: number) => {
      current.current = id;
      setOpenId(id);
      setCard(null);
      setError(null);
      load(id)
        .then((c) => current.current === id && setCard(c))
        .catch((e: Error) => current.current === id && setError(e.message));
    },
    [load],
  );
  const prefetch = useCallback((id: number) => void load(id).catch(() => {}), [load]);

  return (
    <CardContext.Provider value={{ open, prefetch }}>
      {children}
      <Dialog
        open={openId != null}
        onOpenChange={(o) => {
          if (!o) {
            current.current = null;
            setOpenId(null);
          }
        }}
      >
        <DialogContent
          className={cn(
            "max-h-[88dvh] gap-0 overflow-y-auto p-0 sm:max-w-xl",
            // Phones: a bottom sheet.
            "max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none",
          )}
        >
          {card ? (
            <CardBody card={card} />
          ) : error ? (
            <div className="p-6">
              <DialogTitle>Couldn&apos;t load this player</DialogTitle>
              <DialogDescription className="mt-2">{error}</DialogDescription>
            </div>
          ) : (
            <CardSkeleton />
          )}
        </DialogContent>
      </Dialog>
    </CardContext.Provider>
  );
}

/** Makes its children open the player's card (and prefetch it on hover). */
export function PlayerCardButton({
  id,
  className,
  children,
}: {
  id: number;
  className?: string;
  children: React.ReactNode;
}) {
  const api = useContext(CardContext);
  return (
    <button
      type="button"
      onClick={() => api?.open(id)}
      onPointerEnter={() => api?.prefetch(id)}
      className={cn(
        "block w-full cursor-pointer text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      {children}
    </button>
  );
}

function CardSkeleton() {
  return (
    <div className="space-y-4 p-5">
      <DialogTitle className="sr-only">Loading player</DialogTitle>
      <div className="flex items-center gap-3">
        <Skeleton className="size-16 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-24 rounded-lg" />
      <Skeleton className="h-40 rounded-lg" />
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  strong,
}: {
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
}) {
  return (
    <div className={cn("rounded-lg border px-3 py-2", strong && "border-primary/40 bg-primary/5")}>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums", strong && "text-primary")}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t px-5 py-4">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Last 10 games' fantasy points as a small line. */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const x = (i: number) => (i / (values.length - 1)) * 100;
  const y = (v: number) => 28 - ((v - min) / (max - min || 1)) * 26;
  return (
    <svg viewBox="0 0 100 30" className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline
        points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        className="text-primary"
      />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={1.6} className="fill-primary" />
      ))}
    </svg>
  );
}

const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);

function CardBody({ card }: { card: PlayerCardData }) {
  const p = card.projection;
  const maxContribution = Math.max(...card.contributions.map((c) => Math.abs(c.points)), 1);
  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 p-5 pr-12">
        <PlayerAvatar id={card.id} name={card.name} size={64} />
        <div className="min-w-0">
          <DialogTitle className="truncate text-lg font-semibold">{card.name}</DialogTitle>
          <DialogDescription asChild>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <TeamLogo abbr={card.proTeam} size={16} />
              <span>
                {card.proTeam} · {card.positions.join("/")}
              </span>
              <StatusPill status={card.status} />
              {card.injury?.back && <span className="text-xs">{card.injury.back}</span>}
              <Pill tone={card.mine ? "success" : card.available ? "info" : "muted"}>
                {card.mine ? "Your team" : card.owner}
              </Pill>
            </div>
          </DialogDescription>
        </div>
      </div>
      {card.injury && (
        <p className="mx-5 mb-4 rounded-lg bg-warning/10 px-3 py-2 text-xs text-foreground">
          {card.injury.note}
        </p>
      )}

      {/* Key numbers */}
      <div className="grid grid-cols-2 gap-2 px-5 pb-4 sm:grid-cols-4">
        <Tile
          label={
            card.next ? `Next: ${card.next.home ? "vs" : "@"} ${card.next.opponent}` : "Next game"
          }
          value={card.next ? fmtPts(p.best) : "—"}
          sub={
            card.next
              ? `${card.next.today ? "Tonight" : card.next.day} ${card.next.tip}`
              : "none scheduled"
          }
          strong
        />
        <Tile
          label={card.formFromLastSeason ? "FP/G (last season)" : "FP/G"}
          value={card.form.fppg != null ? fmtPts(card.form.fppg) : "—"}
          sub={`${card.form.games} game${card.form.games === 1 ? "" : "s"}`}
        />
        <Tile
          label="Last 5"
          value={card.form.last5 != null ? fmtPts(card.form.last5) : "—"}
          sub={
            card.form.last5 != null && card.form.fppg != null
              ? `${card.form.last5 >= card.form.fppg ? "+" : ""}${fmtPts(card.form.last5 - card.form.fppg)} vs avg`
              : undefined
          }
        />
        <Tile
          label="Minutes"
          value={card.form.minutes != null ? card.form.minutes.toFixed(1) : "—"}
          sub={
            card.form.minutesLast5 != null
              ? `last 5: ${card.form.minutesLast5.toFixed(1)}`
              : undefined
          }
        />
      </div>

      <Section title="Next game projection">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border px-2 py-2">
            <div className="text-[11px] text-muted-foreground">Our model</div>
            <div className="font-semibold tabular-nums">{fmtPts(p.ours)}</div>
          </div>
          <div className="rounded-lg border px-2 py-2">
            <div className="text-[11px] text-muted-foreground">Vegas</div>
            <div className="font-semibold tabular-nums">
              {p.vegas != null ? fmtPts(p.vegas) : "—"}
            </div>
          </div>
          <div className="rounded-lg border px-2 py-2">
            <div className="text-[11px] text-muted-foreground">ESPN</div>
            <div className="font-semibold tabular-nums">
              {p.espn != null ? fmtPts(p.espn) : "—"}
            </div>
          </div>
        </div>
        {p.vegasLines.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {p.vegasLines.map((l) => (
              <span key={l.market} className="rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums">
                {l.line} {l.market}
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          The number under his score is the most accurate source we have: our model until the Vegas
          blend passes its accuracy test. Our model blends ESPN&apos;s preseason projection with
          this season&apos;s games, minutes trend and the game&apos;s Vegas total
          {p.environment !== 1 && ` (×${p.environment.toFixed(2)} tonight)`}; Vegas posts player
          lines a few hours before tip and already reflects late news.{" "}
          <Link href="/nba/model" className="text-primary hover:underline">
            Accuracy so far
          </Link>
        </p>
      </Section>

      <Section title="Recent form">
        <Spark values={card.form.spark} />
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-muted-foreground">
                {["Date", "Opp", "MIN", "PTS", "REB", "AST", "STL", "BLK", "TO", "FG", "FP"].map(
                  (h) => (
                    <th
                      key={h}
                      className={cn(
                        "px-1 py-1 font-medium",
                        h === "Date" || h === "Opp" ? "text-left" : "text-right",
                      )}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {card.recent.map((g, i) => (
                <tr key={i} className="border-t">
                  <td className="px-1 py-1">{g.date}</td>
                  <td className="px-1 py-1 whitespace-nowrap">
                    {g.home ? "" : "@"}
                    {g.opponent}
                  </td>
                  {["MIN", "PTS", "REB", "AST", "STL", "BLK", "TO"].map((k) => (
                    <td key={k} className="px-1 py-1 text-right">
                      {g.line[k]}
                    </td>
                  ))}
                  <td className="px-1 py-1 text-right whitespace-nowrap">
                    {g.line.FGM}-{g.line.FGA}
                  </td>
                  <td className="px-1 py-1 text-right font-semibold">{fmtPts(g.fp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!card.recent.length && (
            <p className="px-1 text-xs text-muted-foreground">No games yet.</p>
          )}
        </div>
      </Section>

      <Section title="Where his points come from (per game)">
        <div className="space-y-1">
          {card.contributions.map((c) => (
            <div
              key={c.stat}
              className="grid grid-cols-[3.5rem_3rem_1fr_3rem] items-center gap-2 text-xs tabular-nums"
            >
              <span className="font-medium">
                {c.stat === "FGMI" ? "FG miss" : c.stat === "FTMI" ? "FT miss" : c.stat}
              </span>
              <span className="text-right text-muted-foreground">{c.perGame.toFixed(1)}</span>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    c.points >= 0 ? "bg-success/70" : "bg-danger/70",
                  )}
                  style={{ width: `${(Math.abs(c.points) / maxContribution) * 100}%` }}
                />
              </div>
              <span className={cn("text-right", c.points < 0 && "text-danger")}>
                {c.points >= 0 ? "+" : ""}
                {c.points.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Rest of season">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile
            label="Games left"
            value={String(card.rest.gamesLeft)}
            sub={card.injury?.back ?? undefined}
          />
          <Tile
            label="Projected points"
            value={Math.round(card.rest.projectedPoints).toLocaleString("en-US")}
          />
          {card.rest.starts && (
            <Tile
              label="Starts"
              value={`${card.rest.starts.starts}/${card.rest.starts.games}`}
              sub={`on ${card.rest.starts.team}`}
            />
          )}
          <Tile
            label="Market value"
            value={`$${card.rest.marketValue.toFixed(0)}`}
            sub={card.rest.adp ? `ADP ${card.rest.adp.toFixed(0)}` : undefined}
          />
          <Tile
            label="Rostered"
            value={pct(card.rest.owned)}
            sub={
              card.rest.ownedChange != null
                ? `${card.rest.ownedChange >= 0 ? "+" : ""}${card.rest.ownedChange.toFixed(1)} this week`
                : undefined
            }
          />
        </div>
      </Section>

      <Section title="Schedule">
        <div className="flex flex-wrap gap-1.5">
          {card.schedule.map((g, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
            >
              <span className="text-muted-foreground">{g.day.split(" ")[0]}</span>
              <TeamLogo abbr={g.opponent} size={12} />
              {g.home ? "" : "@"}
              {g.opponent}
            </span>
          ))}
        </div>
      </Section>

      <div className="border-t px-5 py-3">
        <Link
          href={`/nba/players/${card.id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Full player page <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}
