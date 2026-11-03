// A team's season story (server component, streamed after the roster): its odds over time,
// every roster move with what it did, and the games its players have missed.

import Link from "next/link";
import { PlayerCardButton } from "@/components/fc/player-card";
import { SectionTitle } from "@/components/fc/bits";
import { Pill, StatusPill } from "@/components/fc/status-pill";
import { OddsChart } from "@/components/odds-chart";
import { DISPLAY_TZ } from "@/lib/env";
import { fmtPts } from "@/lib/format";
import type {
  mostImpactfulMoves,
  MovePlayer,
  MoveReport,
  teamHistory,
} from "@/lib/nba/move-history";
import { outlookHistory } from "@/lib/nba/outlook-run";
import { cn } from "@/lib/utils";

const TYPE = { WAIVER: "Waiver claim", FREEAGENT: "Free agent", TRADE: "Trade" } as const;

/** Percentage points, signed: "+2.1". */
const points = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}`;
const signed = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v)}`;
const tone = (v: number, dead = 0) =>
  v > dead ? "text-success" : v < -dead ? "text-danger" : "text-muted-foreground";

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TZ,
  });

function Players({ list, sign }: { list: MovePlayer[]; sign: "+" | "−" }) {
  return (
    <>
      {list.map((p) => (
        <div key={p.id} className="flex items-baseline justify-between gap-2 text-sm">
          <PlayerCardButton id={p.id} className="min-w-0 text-left hover:underline">
            <span className={cn("font-medium", sign === "+" ? "text-success" : "text-danger")}>
              {sign}
            </span>{" "}
            <span className="break-words">{p.name}</span>
          </PlayerCardButton>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {fmtPts(p.points)} pts in {p.games} g · {Math.round(p.rosNow)} left
          </span>
        </div>
      ))}
    </>
  );
}

function MoveRow({ m }: { m: MoveReport }) {
  const t = m.atTheTime;
  return (
    <div className="space-y-1.5 px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Pill tone={m.type === "TRADE" ? "info" : "muted"}>{TYPE[m.type]}</Pill>
        <span>{when(m.at)}</span>
      </div>
      <div className="space-y-0.5">
        <Players list={m.adds} sign="+" />
        <Players list={m.drops} sign="−" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
        <div>
          <div className="text-muted-foreground">At the time</div>
          {t ? (
            <div title={`Outlook runs ${when(t.before)} → ${when(t.after)}`}>
              <span className={cn("font-semibold", tone(t.champ, 0.0005))}>
                {t.clean ? "" : "≈"}
                {points(t.champ)} title
              </span>
              <span className="text-muted-foreground"> · {points(t.playoffs)} playoffs</span>
            </div>
          ) : (
            <div className="text-muted-foreground">—</div>
          )}
        </div>
        <div>
          <div className="text-muted-foreground">Since</div>
          <div className={cn("font-semibold", tone(m.pointsNet, 0.5))}>
            {signed(m.pointsNet)} pts
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Rest of season</div>
          <div className={cn("font-semibold", tone(m.rosNet, 0.5))}>{signed(m.rosNet)} pts</div>
        </div>
      </div>
    </div>
  );
}

export async function TeamStory({
  teamId,
  history,
}: {
  teamId: number;
  history: ReturnType<typeof teamHistory>;
}) {
  const [h, odds] = await Promise.all([
    history.catch(() => null),
    outlookHistory(teamId).catch(() => []),
  ]);
  const best = h?.moves
    .filter((m) => m.atTheTime?.clean)
    .sort((a, b) => Math.abs(b.atTheTime!.champ) - Math.abs(a.atTheTime!.champ))[0];
  return (
    <>
      {odds.length > 1 && (
        <section className="space-y-1.5">
          <SectionTitle>Odds over time</SectionTitle>
          <div className="rounded-xl border bg-card p-3 sm:p-4">
            <OddsChart points={odds} />
          </div>
        </section>
      )}

      {h && (
        <section className="space-y-1.5">
          <SectionTitle aside={`${h.moves.length} this season`}>Roster moves</SectionTitle>
          {h.moves.length ? (
            <>
              {best && best.atTheTime && Math.abs(best.atTheTime.champ) >= 0.0005 && (
                <p className="px-1 text-sm">
                  Biggest so far:{" "}
                  <span className="font-medium">
                    {[
                      ...best.adds.map((p) => `+${p.name}`),
                      ...best.drops.map((p) => `−${p.name}`),
                    ].join(", ")}
                  </span>{" "}
                  on {when(best.at).split(",")[0]},{" "}
                  <span className={cn("font-semibold", tone(best.atTheTime.champ))}>
                    {points(best.atTheTime.champ)}
                  </span>{" "}
                  title points.
                </p>
              )}
              <div className="divide-y overflow-hidden rounded-xl border bg-card">
                {h.moves.map((m, i) => (
                  <MoveRow key={i} m={m} />
                ))}
              </div>
            </>
          ) : (
            <p className="rounded-xl border bg-card px-3 py-2.5 text-sm text-muted-foreground">
              No adds, drops or trades yet this season.
            </p>
          )}
          <p className="px-1 text-xs text-muted-foreground">
            At the time: the team&apos;s title and playoff odds (percentage points) in the season
            simulation just after the move vs just before. ≈ when other moves or games fell between
            the two runs. Since: fantasy points the added players scored after the move (while on
            this roster) minus what the dropped players scored. Rest of season: projected points of
            the players in minus out, from today.
          </p>
        </section>
      )}

      {h && h.injuries.length > 0 && (
        <section className="space-y-1.5">
          <SectionTitle aside="Games missed while on this roster">Injuries and rest</SectionTitle>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {h.injuries.map((p) => (
              <PlayerCardButton
                key={p.id}
                id={p.id}
                className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-muted/50"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="font-medium break-words">{p.name}</span>
                  <StatusPill status={p.status} />
                </span>
                <span className="shrink-0 text-xs tabular-nums">
                  {p.missed} g ·{" "}
                  <span className="font-semibold text-danger">−{Math.round(p.pointsLost)} pts</span>
                </span>
              </PlayerCardButton>
            ))}
          </div>
          <p className="px-1 text-xs text-muted-foreground">
            His NBA team&apos;s games he didn&apos;t play since joining this roster (injury, rest or
            coach&apos;s decision), times his projection: roughly the points it has cost. A traded
            NBA player counts his current team&apos;s games.
          </p>
        </section>
      )}
    </>
  );
}

/** League page: the season's moves that changed their team's title odds most at the time. */
export async function ImpactfulMoves({
  moves,
  teams,
}: {
  moves: ReturnType<typeof mostImpactfulMoves>;
  teams: { id: number; name: string; mine: boolean }[];
}) {
  const list = await moves.catch(() => []);
  if (!list.length) return null;
  const byId = new Map(teams.map((t) => [t.id, t]));
  return (
    <section className="space-y-1.5">
      <SectionTitle aside="Title odds just before vs after">Most impactful moves</SectionTitle>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {list.map((m, i) => {
          const team = byId.get(m.teamId);
          return (
            <Link
              key={i}
              href={`/nba/league/${m.teamId}`}
              className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/50"
            >
              <div className="min-w-0">
                <div
                  className={cn("text-sm break-words", team?.mine && "font-semibold text-primary")}
                >
                  {team?.name ?? `Team ${m.teamId}`}
                </div>
                <div className="text-xs break-words text-muted-foreground">
                  {when(m.at).split(",")[0]} ·{" "}
                  {[...m.adds.map((p) => `+${p.name}`), ...m.drops.map((p) => `−${p.name}`)].join(
                    ", ",
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <div className={cn("font-semibold", tone(m.atTheTime.champ))}>
                  {points(m.atTheTime.champ)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {points(m.atTheTime.playoffs)} playoffs
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        Moves with no other move or game between the simulation runs before and after, so the change
        is the move&apos;s own. Tap a team for its full history.
      </p>
    </section>
  );
}
