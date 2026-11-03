import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Callout, StatTile } from "@/components/fc/bits";
import { PlayerAvatar } from "@/components/fc/player-avatar";
import { Pill, StatusPill } from "@/components/fc/status-pill";
import { TeamLogo } from "@/components/fc/team-logo";
import { PlayerSeasons } from "@/components/fc/player-seasons";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { SetupError } from "@/lib/env";
import { fmtPts } from "@/lib/format";
import { espnConfig } from "@/lib/env";
import { LAST_SCORING_PERIOD, scoringPeriodForDate, gameDate } from "@/lib/nba/calendar";
import { nbaSchedule } from "@/lib/nba/data";
import { propsForGames } from "@/lib/nba/market-data";
import { scoreGames, summarize } from "@/lib/nba/player";
import { loadPlayerCard } from "@/lib/nba/player-card";
import { loadPlayer } from "@/lib/nba/pool";
import { perGameProjection } from "@/lib/nba/projection";
import { vegasProjection } from "@/lib/nba/vegas";

const seasonLabel = (s: number) => `${s - 1}-${String(s).slice(2)}`;

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const id = Number((await params).id);
  const { season } = await searchParams;
  if (!Number.isInteger(id) || id <= 0) notFound();

  let p;
  try {
    p = await loadPlayer(id);
  } catch (e) {
    if (e instanceof SetupError) return <SetupNotice message={e.message} />;
    return <ErrorNotice title="Couldn't load this player" message={(e as Error).message} />;
  }
  if (!p) notFound();
  // Both seasons with the card's numbers (advanced stats, percentiles) for the season view.
  const card = await loadPlayerCard(id, undefined, true).catch(() => null);

  const { entry, fa, injury } = p;
  const pl = entry.player;
  const rows = scoreGames(p.log, p.scoring);
  const sum = summarize(rows);
  const proj = perGameProjection(pl).fppg;
  const fromLastSeason = p.logSeason !== p.season;

  // Tonight's game, as the sportsbooks see it (when props are posted).
  const sp = Math.min(Math.max(scoringPeriodForDate(gameDate()), 1), LAST_SCORING_PERIOD);
  const tonight = (await nbaSchedule(espnConfig().season).catch(() => [])).find(
    (g) =>
      g.scoringPeriodId === sp &&
      (g.homeProTeamId === pl.proTeamId || g.awayProTeamId === pl.proTeamId),
  );
  const lines = tonight
    ? ((await propsForGames([tonight.gameId]).catch(() => new Map())).get(pl.id) ?? [])
    : [];
  const vegas = vegasProjection(
    lines,
    pl.projection?.stats,
    perGameProjection(pl, sp).fppg,
    p.scoring,
  );

  return (
    <>
      <Link
        href="/nba/players"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Players
      </Link>

      <div className="flex items-center gap-4">
        <PlayerAvatar id={pl.id} name={pl.name} size={72} />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{pl.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <TeamLogo abbr={pl.proTeam} size={18} />
            <span>
              {pl.proTeam} · {pl.positions.join("/")}
            </span>
            <StatusPill status={pl.injuryStatus ?? "ACTIVE"} note={injury?.short} />
            {entry.mine ? (
              <Pill tone="success">Your team</Pill>
            ) : entry.available ? (
              <Pill tone="info">{entry.owner}</Pill>
            ) : (
              <Pill>{entry.owner}</Pill>
            )}
          </div>
        </div>
      </div>

      {injury && (
        <Callout tone="warning">
          <span className="font-medium">{injury.status}:</span> {injury.long || injury.short}
        </Callout>
      )}
      {vegas && (
        <Callout tone="info">
          <span className="font-medium">Tonight, Vegas projects {fmtPts(vegas.fppg)} FP</span>{" "}
          (ours: {fmtPts(perGameProjection(pl, sp).fppg)}).{" "}
          <span className="text-muted-foreground">
            DraftKings lines:{" "}
            {lines
              .map((l: { market: string; line: number }) => `${l.line} ${l.market}`)
              .join(" · ")}
          </span>
        </Callout>
      )}
      {fa && (
        <Callout tone="info">
          {fa.status === "WAIVERS" ? "On waivers. " : "Free agent. "}See how he&apos;d fit your week
          on{" "}
          <Link
            href="/nba/players"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Players → Moves
          </Link>
          .
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="Projected FP/G"
          value={fmtPts(proj)}
          sub={`ESPN, ${seasonLabel(p.season)}`}
        />
        <StatTile
          label={fromLastSeason ? `FP/G ${seasonLabel(p.logSeason)}` : "FP/G this season"}
          value={sum.fppg != null ? fmtPts(sum.fppg) : "—"}
          sub={`${sum.games} regular-season game${sum.games === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Last 5 games"
          value={sum.last5 != null ? fmtPts(sum.last5) : "—"}
          delta={
            sum.last5 != null && sum.fppg != null && Math.abs(sum.last5 - sum.fppg) >= 0.5
              ? {
                  text: `${sum.last5 >= sum.fppg ? "+" : ""}${fmtPts(sum.last5 - sum.fppg)} vs avg`,
                  up: sum.last5 >= sum.fppg,
                }
              : null
          }
        />
        <StatTile
          label="Minutes"
          value={sum.minutes != null ? sum.minutes.toFixed(1) : "—"}
          sub={sum.minutesLast5 != null ? `${sum.minutesLast5.toFixed(1)} last 5` : undefined}
        />
      </div>

      {card?.logs ? (
        <PlayerSeasons
          card={card}
          logs={card.logs}
          initial={season === "last" || !card.seasons.current.split ? "last" : "current"}
        />
      ) : rows.length === 0 ? (
        <Callout tone="info">No NBA games on record for him yet.</Callout>
      ) : null}
    </>
  );
}
