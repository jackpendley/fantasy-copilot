// Players → Draft: the draft in hindsight. Our pre-draft rankings (uploaded in Settings) next to
// ESPN's draft and this season so far, how accurate our preseason projection was, and the draft
// Jack's picks would have been knowing what we know now (lib/nba/draft-review.ts).

import Link from "next/link";
import { Callout, SectionTitle } from "@/components/fc/bits";
import { PlayerCardButton } from "@/components/fc/player-card";
import { ErrorNotice, SetupNotice } from "@/components/setup-notice";
import { SetupError } from "@/lib/env";
import { fmtDayTime, fmtPts } from "@/lib/format";
import { MIN_GAMES_JUDGED } from "@/lib/nba/draft-review";
import { loadDraftReview, type DraftRow } from "@/lib/nba/draft-view";
import { cn } from "@/lib/utils";

const SORTS = {
  ours: { label: "Our rank", key: (r: DraftRow) => r.ours?.rank ?? Infinity, asc: true },
  pick: { label: "ESPN pick", key: (r: DraftRow) => r.pick?.overall ?? Infinity, asc: true },
  actual: { label: "FP/G", key: (r: DraftRow) => r.actual ?? -Infinity, asc: false },
  diff: {
    label: "Vs projection",
    key: (r: DraftRow) => (r.actual != null && r.ours ? r.actual - r.ours.fppg : -Infinity),
    asc: false,
  },
  redraft: { label: "Redraft", key: (r: DraftRow) => r.redraftRank, asc: true },
} as const;
type Sort = keyof typeof SORTS;
const FILTERS = { top: "Top 150", mine: "Your picks", all: "All" } as const;
type Filter = keyof typeof FILTERS;

const signed = (n: number) => `${n >= 0 ? "+" : ""}${fmtPts(n)}`;

export default async function DraftPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; show?: string }>;
}) {
  const params = await searchParams;
  const sort: Sort = params.sort && params.sort in SORTS ? (params.sort as Sort) : "ours";
  const show: Filter = params.show && params.show in FILTERS ? (params.show as Filter) : "top";
  let v;
  try {
    v = await loadDraftReview();
  } catch (e) {
    if (e instanceof SetupError) return <SetupNotice message={e.message} />;
    return <ErrorNotice title="Couldn't load the draft" message={(e as Error).message} />;
  }
  const name = (id: number) => v.players.get(id)?.player.name ?? `#${id}`;
  const href = (s: Sort, f: Filter) => `/nba/players/draft?sort=${s}&show=${f}`;
  const s = SORTS[sort];
  const rows = v.rows
    .filter((r) =>
      show === "mine"
        ? r.pick?.teamId === v.me
        : show === "top"
          ? (r.ours?.rank ?? Infinity) <= 150 || (r.pick?.overall ?? Infinity) <= 150
          : true,
    )
    .sort((a, b) => (s.asc ? s.key(a) - s.key(b) : s.key(b) - s.key(a)));
  const a = v.accuracy;

  return (
    <>
      <p className="px-1 text-sm text-muted-foreground">
        Our rankings, ESPN&apos;s draft and the season so far
        {v.rankingsAt ? ` · rankings imported ${fmtDayTime(v.rankingsAt)}` : ""}
      </p>
      {!v.rankingsAt && (
        <Callout tone="info">
          Import your pre-draft rankings in{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>{" "}
          to compare them with the draft and the season.
        </Callout>
      )}

      {v.rankingsAt && !a && (
        <Callout tone="info">
          How our projection held up appears once ranked players have {MIN_GAMES_JUDGED}+ games.
        </Callout>
      )}

      {a && (
        <section className="space-y-1.5">
          <SectionTitle aside={`${a.n} ranked players with ${MIN_GAMES_JUDGED}+ games`}>
            How our projection held up
          </SectionTitle>
          <div className="space-y-3 rounded-xl border bg-card p-3 text-sm">
            <p>
              Our preseason FP/G was off by <b className="tabular-nums">{fmtPts(a.mae)}</b> a game
              on average.
              {a.baseline && (
                <>
                  {" "}
                  On the {a.baseline.n} who also played 20+ games last season, ours missed by{" "}
                  <b className="tabular-nums">{fmtPts(a.baseline.oursOnSame)}</b>; simply carrying
                  over last season&apos;s FP/G (this season&apos;s scoring) missed by{" "}
                  <b className="tabular-nums">{fmtPts(a.baseline.mae)}</b>.
                </>
              )}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { title: "Better than we projected", list: a.over },
                { title: "Worse than we projected", list: a.under },
              ].map(({ title, list }) => (
                <div key={title} className="space-y-1">
                  <div className="text-xs font-medium">{title}</div>
                  {list.map((m) => (
                    <PlayerCardButton
                      key={m.playerId}
                      id={m.playerId}
                      className="flex w-full justify-between gap-2 text-xs hover:underline"
                    >
                      <span className="truncate">{m.name}</span>
                      <span className="shrink-0 tabular-nums">
                        {fmtPts(m.pre)} → {fmtPts(m.actual)}{" "}
                        <span className={m.actual > m.pre ? "text-success" : "text-danger"}>
                          ({signed(m.actual - m.pre)})
                        </span>
                      </span>
                    </PlayerCardButton>
                  ))}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              ESPN&apos;s own preseason projections aren&apos;t kept (ESPN updates them in place),
              so last season is the comparison.
            </p>
          </div>
        </section>
      )}

      <section className="space-y-1.5">
        <SectionTitle aside="Full-season value: points so far as a starter, plus the rest">
          Your draft in hindsight
        </SectionTitle>
        {v.hindsight ? (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-2 text-left font-medium">Pick</th>
                  <th className="px-3 py-2 text-left font-medium">You took</th>
                  <th className="px-3 py-2 text-left font-medium">Knowing what we know now</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {v.hindsight.actual.map((p, i) => {
                  const h = v.hindsight!.hindsight[i];
                  return (
                    <tr key={p.overall}>
                      <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                        R{p.round} · {p.overall}
                      </td>
                      <td className="px-3 py-1.5">
                        <PlayerCardButton id={p.playerId} className="hover:underline">
                          {name(p.playerId)}
                        </PlayerCardButton>{" "}
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {Math.round(p.value)}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        {h && (
                          <>
                            <PlayerCardButton
                              id={h.playerId}
                              className={cn(
                                "hover:underline",
                                h.playerId === p.playerId && "text-muted-foreground",
                              )}
                            >
                              {name(h.playerId)}
                            </PlayerCardButton>{" "}
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {Math.round(h.value)}
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t text-xs">
                <tr>
                  <td className="px-3 py-2 text-muted-foreground">Team</td>
                  <td className="px-3 py-2 font-semibold tabular-nums">
                    {Math.round(v.hindsight.actualValue).toLocaleString("en-US")}
                  </td>
                  <td className="px-3 py-2 font-semibold tabular-nums">
                    {Math.round(v.hindsight.hindsightValue).toLocaleString("en-US")}{" "}
                    <span
                      className={cn(
                        "font-normal",
                        v.hindsight.hindsightValue >= v.hindsight.actualValue
                          ? "text-success"
                          : "text-danger",
                      )}
                    >
                      ({v.hindsight.hindsightValue >= v.hindsight.actualValue ? "+" : "−"}
                      {Math.abs(
                        Math.round(v.hindsight.hindsightValue - v.hindsight.actualValue),
                      ).toLocaleString("en-US")}
                      )
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <Callout tone="info">
            Working out the hindsight draft (a minute or so after this visit). Refresh to see it.
          </Callout>
        )}
        <p className="px-1 text-xs text-muted-foreground">
          Every other team&apos;s picks stay as they were. At each of your picks it takes the
          available player who adds the most to the team built so far: points so far (counted at the
          share of games he&apos;d start for you) plus his projected starting points for the rest of
          the season, playoff weeks weighted, positions and roster slots included. A player it takes
          before another team did leaves that team&apos;s pick empty.
          {v.hindsight && !v.hindsightFresh && " From yesterday; today's is being worked out."}
        </p>
      </section>

      <section className="space-y-1.5">
        <SectionTitle aside={`${rows.length} players`}>Rankings vs the season</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
            <Link
              key={f}
              href={href(sort, f)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-medium",
                f === show
                  ? "border-primary bg-primary/10 text-primary"
                  : "bg-card text-muted-foreground",
              )}
            >
              {FILTERS[f]}
            </Link>
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-medium">Player</th>
                {(
                  [
                    ["ours", "Ours"],
                    ["pick", "Pick"],
                    [null, "Proj"],
                    ["actual", "FP/G"],
                    ["diff", "+/−"],
                    [null, "Now"],
                    [null, "FP/G rk"],
                    ["redraft", "Redraft"],
                  ] as const
                ).map(([k, label]) => (
                  <th key={label} className="px-2 py-2 text-right font-medium">
                    {k ? (
                      <Link
                        href={href(k, show)}
                        className={cn(k === sort && "text-foreground underline")}
                      >
                        {label}
                      </Link>
                    ) : (
                      label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const diff = r.actual != null && r.ours ? r.actual - r.ours.fppg : null;
                return (
                  <tr key={r.entry.player.id}>
                    <td className="px-3 py-1.5">
                      <PlayerCardButton
                        id={r.entry.player.id}
                        className="text-left hover:underline"
                      >
                        <span className="font-medium">{r.entry.player.name}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {r.entry.player.positions.join("/")}
                          {r.pickedBy &&
                            ` · drafted by ${r.pick?.teamId === v.me ? "you" : r.pickedBy}`}
                        </span>
                      </PlayerCardButton>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.ours?.rank ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.pick?.overall ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right text-muted-foreground tabular-nums">
                      {r.ours ? fmtPts(r.ours.fppg) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                      {r.actual != null && r.games > 0 ? fmtPts(r.actual) : "—"}
                      <span className="block text-[10px] font-normal text-muted-foreground">
                        {r.games} g
                      </span>
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right tabular-nums",
                        diff == null || r.games < MIN_GAMES_JUDGED
                          ? "text-muted-foreground"
                          : diff > 0
                            ? "text-success"
                            : "text-danger",
                      )}
                    >
                      {diff != null && r.games > 0 ? signed(diff) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtPts(r.now)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.fppgRank ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.redraftRank}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          Ours: our pre-draft rank and projected FP/G. Pick: where ESPN&apos;s draft took him. Now:
          today&apos;s projection. FP/G rk: this season (5+ games). Redraft: by projected points for
          the rest of the season, if the league drafted today.
        </p>
      </section>
    </>
  );
}
