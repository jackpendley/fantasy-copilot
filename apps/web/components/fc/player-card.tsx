"use client";

// Player card: tap any player row for everything we know and project about him. Two tabs:
//  - Live (or Final) while his game is on today; Next game otherwise.
//  - Season, against last season.
// Data comes from /api/players/[id]/card. It's prefetched on hover and kept for a minute
// (15 seconds while his game is live). While the card is open during a game it refreshes
// every 20 seconds, and again when the app comes back to the foreground.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtPts } from "@/lib/display";
import type { Contribution } from "@/lib/nba/card-stats";
import type { LiveGame, PlayerCardData, SeasonBlock } from "@/lib/nba/player-card";
import { cn } from "@/lib/utils";
import { PlayerAvatar } from "./player-avatar";
import { Pill, StatusPill } from "./status-pill";
import { TeamLogo } from "./team-logo";

interface CardApi {
  open: (id: number) => void;
  prefetch: (id: number) => void;
}

const CardContext = createContext<CardApi | null>(null);

const FRESH_MS = 60_000;
const LIVE_FRESH_MS = 15_000;
const LIVE_POLL_MS = 20_000;

type Entry = { at: number; data: Promise<PlayerCardData>; live: boolean };

export function PlayerCardProvider({ children }: { children: React.ReactNode }) {
  const cache = useRef(new Map<number, Entry>());
  const current = useRef<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [card, setCard] = useState<PlayerCardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchCard = useCallback((id: number) => {
    const data = fetch(`/api/players/${id}/card`, { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      return r.json() as Promise<PlayerCardData>;
    });
    const entry: Entry = { at: Date.now(), data, live: false };
    cache.current.set(id, entry);
    data.then(
      (c) => (entry.live = c.live?.state === "in"),
      () => cache.current.get(id) === entry && cache.current.delete(id),
    );
    return data;
  }, []);

  /** A cached card if it's fresh enough, otherwise a new request. */
  const load = useCallback(
    (id: number) => {
      const hit = cache.current.get(id);
      const maxAge = hit?.live ? LIVE_FRESH_MS : FRESH_MS;
      return hit && Date.now() - hit.at < maxAge ? hit.data : fetchCard(id);
    },
    [fetchCard],
  );

  const show = useCallback((id: number, p: Promise<PlayerCardData>) => {
    p.then((c) => {
      if (current.current === id) {
        setCard(c);
        setError(null);
      }
    }).catch((e: Error) => current.current === id && setError(e.message));
  }, []);

  const open = useCallback(
    (id: number) => {
      current.current = id;
      setOpenId(id);
      setError(null);
      // Show what we have at once (even if a refresh is coming), never another player's card.
      const hit = cache.current.get(id);
      setCard(null);
      if (hit) hit.data.then((c) => current.current === id && setCard(c)).catch(() => {});
      show(id, load(id));
    },
    [load, show],
  );
  const prefetch = useCallback((id: number) => void load(id).catch(() => {}), [load]);

  // While open: refresh during a live game, and whenever the app comes back to the foreground.
  const live = card?.live?.state === "in";
  useEffect(() => {
    if (openId == null) return;
    const refresh = () => {
      if (document.visibilityState === "visible") show(openId, fetchCard(openId));
    };
    const timer = live ? setInterval(refresh, LIVE_POLL_MS) : null;
    const onVisible = () => {
      const hit = cache.current.get(openId);
      if (!hit || Date.now() - hit.at > (hit.live ? LIVE_FRESH_MS : FRESH_MS)) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [openId, live, fetchCard, show]);

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
          {card && card.id === openId ? (
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
      <Skeleton className="h-8 w-48 rounded-lg" />
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

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 border-t px-5 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {aside && <span className="text-[11px] text-muted-foreground">{aside}</span>}
      </div>
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
const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
const STAT_LABEL: Record<string, string> = { FG: "FG (net)", FT: "FT (net)" };

/**
 * Fantasy points by stat as bars from zero: green adds, red costs. FG and FT are one net bar
 * each (makes minus misses), so efficient shooting shows green.
 */
function ContributionBars({ items }: { items: Contribution[] }) {
  const max = Math.max(...items.map((c) => Math.abs(c.points)), 1);
  return (
    <div className="space-y-1">
      {items.map((c) => (
        <div
          key={c.stat}
          className="grid grid-cols-[4.25rem_4.25rem_1fr_3rem] items-center gap-2 text-xs tabular-nums"
        >
          <span className="font-medium">{STAT_LABEL[c.stat] ?? c.stat}</span>
          <span className="text-right text-muted-foreground">{c.detail}</span>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                c.points >= 0 ? "bg-success/70" : "bg-danger/70",
              )}
              style={{ width: `${(Math.abs(c.points) / max) * 100}%` }}
            />
          </div>
          <span className={cn("text-right", c.points < 0 && "text-danger")}>
            {signed(c.points)}
          </span>
        </div>
      ))}
    </div>
  );
}

const BOX = ["MIN", "PTS", "REB", "AST", "STL", "BLK", "3PM", "TO", "PF"];

function LiveTab({ g, card }: { g: LiveGame; card: PlayerCardData }) {
  const final = g.state === "post";
  const l = g.line;
  const foulTrouble = !final && l != null && (l.PF ?? 0) >= 4;
  const vsProj = g.projectedFinal - g.pregame;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-5 pb-3 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">{g.home ? "vs" : "@"}</span>
          <TeamLogo abbr={g.opponent} size={16} />
          <span className="font-medium">{g.opponent}</span>
          {g.teamScore != null && g.oppScore != null && (
            <span className="tabular-nums">
              {g.teamScore}-{g.oppScore}
            </span>
          )}
        </span>
        <span className={cn("text-xs font-medium tabular-nums", !final && "text-danger")}>
          {!final && (
            <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-danger" />
          )}
          {g.status}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 px-5 pb-4">
        <Tile label={final ? "Scored" : "Fantasy pts"} value={fmtPts(g.fp)} strong />
        <Tile
          label={final ? "Pregame projection" : "Heading for"}
          value={fmtPts(final ? g.pregame : g.projectedFinal)}
          sub={final ? `${signed(g.fp - g.pregame)} vs projection` : `${signed(vsProj)} vs pregame`}
        />
        <Tile
          label="Minutes"
          value={l ? String(l.MIN ?? 0) : "—"}
          sub={final ? undefined : `expects ~${g.expectedMinutes.toFixed(0)}`}
        />
      </div>
      {foulTrouble && (
        <p className="mx-5 mb-3 rounded-lg bg-warning/10 px-3 py-2 text-xs">
          Foul trouble: {l!.PF} fouls. His minutes, and the projection above, may come in lower.
        </p>
      )}

      <Section title="Box score">
        {l ? (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-muted-foreground">
                  {[...BOX, "FG", "FT"].map((h) => (
                    <th key={h} className="px-1 py-1 text-right font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t font-medium">
                  {BOX.map((k) => (
                    <td key={k} className="px-1 py-1 text-right">
                      {l[k] ?? 0}
                    </td>
                  ))}
                  <td className="px-1 py-1 text-right whitespace-nowrap">
                    {l.FGM ?? 0}-{l.FGA ?? 0}
                  </td>
                  <td className="px-1 py-1 text-right whitespace-nowrap">
                    {l.FTM ?? 0}-{l.FTA ?? 0}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {final ? "He didn't play." : "Hasn't checked in yet."}
          </p>
        )}
      </Section>

      {g.byStat.length > 0 && (
        <Section title={final ? "His points by stat" : "His points so far"}>
          <ContributionBars items={g.byStat} />
        </Section>
      )}

      {g.props.length > 0 && (
        <Section title="Against his Vegas lines">
          <div className="space-y-1.5">
            {g.props.map((p) => {
              const share = Math.min(1, p.current / Math.max(p.line, 0.5));
              const over = p.current > p.line;
              return (
                <div
                  key={p.market}
                  className="grid grid-cols-[2.5rem_1fr_4.5rem] items-center gap-2 text-xs tabular-nums"
                >
                  <span className="font-medium">{p.market}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        over ? "bg-success/70" : "bg-primary/60",
                      )}
                      style={{ width: `${share * 100}%` }}
                    />
                  </div>
                  <span className={cn("text-right", over && "text-success")}>
                    {p.current} / {p.line}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Sportsbook over/under lines (DraftKings via ESPN; closing lines once the game starts).
          </p>
        </Section>
      )}

      <Section title="Next game">
        <NextLine card={card} />
      </Section>
    </div>
  );
}

function NextLine({ card }: { card: PlayerCardData }) {
  const n = card.next;
  if (!n) return <p className="text-xs text-muted-foreground">No game scheduled.</p>;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-1.5">
        {n.day} · {n.home ? "vs" : "@"}
        <TeamLogo abbr={n.opponent} size={14} />
        {n.opponent} <span className="text-muted-foreground">{n.tip}</span>
      </span>
      <span className="font-semibold tabular-nums">{fmtPts(card.projection.best)}</span>
    </div>
  );
}

function NextTab({ card }: { card: PlayerCardData }) {
  const p = card.projection;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 px-5 pb-4 sm:grid-cols-4">
        <Tile
          label={
            card.next ? `Next: ${card.next.home ? "vs" : "@"} ${card.next.opponent}` : "Next game"
          }
          value={card.next ? fmtPts(p.best) : "—"}
          sub={
            card.next
              ? `${card.next.today ? "Today" : card.next.day} ${card.next.tip}`
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
              ? `${signed(card.form.last5 - card.form.fppg)} vs avg`
              : undefined
          }
        />
        <Tile
          label="Minutes"
          value={card.form.minutes != null ? card.form.minutes.toFixed(1) : "—"}
          sub={p.minutes != null ? `we expect ${p.minutes.toFixed(1)}` : undefined}
        />
      </div>

      <Section title="Next game projection">
        <div className="grid grid-cols-4 gap-2 text-center">
          {(
            [
              ["Our model", p.ours],
              ["Vegas", p.vegas],
              ["ESPN", p.espn],
              ["DARKO", card.darko?.fppg ?? null],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="rounded-lg border px-2 py-2">
              <div className="text-[11px] text-muted-foreground">{label}</div>
              <div className="font-semibold tabular-nums">{v != null ? fmtPts(v) : "—"}</div>
            </div>
          ))}
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
          blend passes its accuracy test. Our model expects his minutes from this season (they move
          fast when a role changes) times his points per minute, adjusted for the game&apos;s Vegas
          total{p.environment !== 1 && ` (×${p.environment.toFixed(2)} for this game)`}. Vegas posts
          player lines a few hours before tip and reflects late news. DARKO is a public daily
          projection, shown for comparison.{" "}
          <Link href="/nba/model" className="text-primary hover:underline">
            Accuracy so far
          </Link>
        </p>
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
    </div>
  );
}

function SeasonNumbers({ s }: { s: SeasonBlock }) {
  const sp = s.split;
  const e = s.espn;
  const pbp = s.pbp;
  const maxZone = Math.max(...(pbp?.zones ?? []).map((z) => z.frequency), 0.01);
  const ts =
    e?.tsPct != null
      ? `${e.tsPct.toFixed(1)}%`
      : pbp?.tsPct != null
        ? `${(pbp.tsPct * 100).toFixed(1)}%`
        : "—";
  return (
    <>
      {sp ? (
        <>
          <div className="grid grid-cols-3 gap-2 px-5 pb-4">
            <Tile label="FP/G" value={fmtPts(sp.fppg)} sub={`${sp.games} games`} strong />
            <Tile
              label="Typical range"
              value={`${fmtPts(sp.floor)}–${fmtPts(sp.ceiling)}`}
              sub="middle half of games"
            />
            <Tile
              label="Per 36 min"
              value={fmtPts(sp.per36)}
              sub={`${sp.minutes.toFixed(1)} min/g`}
            />
            <Tile label="Median" value={fmtPts(sp.median)} />
            <Tile label="Swing" value={`±${sp.sd.toFixed(1)}`} sub="game to game" />
            <Tile label="Best / worst" value={`${fmtPts(sp.best)} / ${fmtPts(sp.worst)}`} />
          </div>
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-muted-foreground">
                  {["MIN", "PTS", "REB", "AST", "STL", "BLK", "3PM", "TO", "FG%", "FT%"].map(
                    (h) => (
                      <th key={h} className="px-1 py-1 text-right font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  {["MIN", "PTS", "REB", "AST", "STL", "BLK", "3PM", "TO"].map((k) => (
                    <td key={k} className="px-1 py-1 text-right">
                      {sp.box[k]!.toFixed(1)}
                    </td>
                  ))}
                  <td className="px-1 py-1 text-right">{(sp.box["FG%"]! * 100).toFixed(1)}</td>
                  <td className="px-1 py-1 text-right">{(sp.box["FT%"]! * 100).toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="px-5 pb-4 text-xs text-muted-foreground">No games this season yet.</p>
      )}

      {(e || pbp) && (
        <Section title="Advanced" aside="ESPN · PBP Stats">
          <div className="grid grid-cols-3 gap-2">
            <Tile
              label="Usage"
              value={pbp?.usage != null ? `${pbp.usage.toFixed(1)}%` : "—"}
              sub="of team plays"
            />
            <Tile
              label="True shooting"
              value={ts}
              sub={e?.efgPct != null ? `eFG ${e.efgPct.toFixed(1)}%` : undefined}
            />
            <Tile label="PER" value={e?.per != null ? e.per.toFixed(1) : "—"} sub="15 = average" />
            <Tile
              label="AST ratio"
              value={e?.astRatio != null ? e.astRatio.toFixed(1) : "—"}
              sub="per 100 plays"
            />
            <Tile
              label="TO ratio"
              value={e?.toRatio != null ? e.toRatio.toFixed(1) : "—"}
              sub="per 100 plays"
            />
            <Tile
              label="+/-"
              value={e?.plusMinus != null ? signed(e.plusMinus, 0) : "—"}
              sub="team pts with him on"
            />
          </div>
          {pbp && pbp.zones.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
                <span>Where his shots come from</span>
                {pbp.shotQuality != null && (
                  <span title="PBP Stats' expected eFG% for his shots: where and how they're taken">
                    shot quality {(pbp.shotQuality * 100).toFixed(1)}%
                  </span>
                )}
              </div>
              {pbp.zones.map((z) => (
                <div
                  key={z.zone}
                  className="grid grid-cols-[6.5rem_1fr_6rem] items-center gap-2 text-xs tabular-nums"
                >
                  <span>{z.zone}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/60"
                      style={{ width: `${(z.frequency / maxZone) * 100}%` }}
                    />
                  </div>
                  <span className="text-right text-muted-foreground">
                    {(z.frequency * 100).toFixed(0)}% ·{" "}
                    {z.accuracy != null ? `${(z.accuracy * 100).toFixed(0)}% made` : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </>
  );
}

function SeasonTab({ card }: { card: PlayerCardData }) {
  const [which, setWhich] = useState<"current" | "last">(
    card.seasons.current.split ? "current" : "last",
  );
  const s = card.seasons[which];
  return (
    <div>
      <div className="flex gap-1 px-5 pb-3">
        {(["current", "last"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setWhich(k)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium",
              which === k ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
            )}
          >
            {card.seasons[k].label}
          </button>
        ))}
      </div>
      <SeasonNumbers s={s} />

      {which === "current" && (
        <>
          <Section title="Recent games">
            <Spark values={card.form.spark} />
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full text-xs tabular-nums">
                <thead>
                  <tr className="text-muted-foreground">
                    {["Date", "Opp", "MIN", "REB", "AST", "STL", "BLK", "TO", "FG", "FT", "FP"].map(
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
                      {["MIN", "REB", "AST", "STL", "BLK", "TO"].map((k) => (
                        <td key={k} className="px-1 py-1 text-right">
                          {g.line[k]}
                        </td>
                      ))}
                      <td className="px-1 py-1 text-right whitespace-nowrap">
                        {g.line.FGM}-{g.line.FGA}
                      </td>
                      <td className="px-1 py-1 text-right whitespace-nowrap">
                        {g.line.FTM}-{g.line.FTA}
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
            <ContributionBars items={card.contributions} />
            <p className="text-[11px] text-muted-foreground">
              FG and FT are makes and misses together: green means he scores more from them than his
              misses cost.
            </p>
          </Section>
        </>
      )}

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
                ? `${signed(card.rest.ownedChange)} this week`
                : undefined
            }
          />
          {card.darko && (
            <Tile
              label="DARKO projection"
              value={fmtPts(card.darko.fppg)}
              sub={`${card.darko.minutes.toFixed(1)} min${card.darko.asOf ? ` · ${card.darko.asOf.slice(5)}` : ""}`}
            />
          )}
        </div>
      </Section>
    </div>
  );
}

function CardBody({ card }: { card: PlayerCardData }) {
  const live = card.live;
  const first = live ? (live.state === "in" ? "Live" : "Final") : "Next game";
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

      <Tabs defaultValue="game" className="gap-0">
        <TabsList className="mx-5 mb-3">
          <TabsTrigger value="game">
            {live?.state === "in" && (
              <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-danger" />
            )}
            {first}
          </TabsTrigger>
          <TabsTrigger value="season">Season</TabsTrigger>
        </TabsList>
        <TabsContent value="game">
          {live ? <LiveTab g={live} card={card} /> : <NextTab card={card} />}
        </TabsContent>
        <TabsContent value="season">
          <SeasonTab card={card} />
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
        <Link
          href={`/nba/players/${card.id}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Full player page <ArrowRight className="size-4" />
        </Link>
        <span className="text-[11px] text-muted-foreground">
          Data: ESPN ·{" "}
          <a
            href="https://www.pbpstats.com"
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            PBP Stats
          </a>{" "}
          ·{" "}
          <a
            href="https://www.darko.app"
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            DARKO
          </a>
        </span>
      </div>
    </div>
  );
}
