import { Callout, PageHeader, SectionTitle } from "@/components/fc/bits";
import { ErrorNotice } from "@/components/setup-notice";
import { dbConfigured } from "@/lib/db";
import {
  blendSetting,
  currentAccuracy,
  darkoSetting,
  type SourceAccuracy,
} from "@/lib/nba/accuracy";
import { etDate } from "@/lib/nba/calendar";

export const dynamic = "force-dynamic";

const LABEL: Record<SourceAccuracy["source"], string> = {
  ours: "Our model",
  vegas: "Vegas (props)",
  blend: "Blend (shown)",
  espn: "ESPN preseason",
  darko: "DARKO",
};

const cell = (w: { games: number; mae: number | null }) =>
  w.mae == null ? "—" : `${w.mae.toFixed(2)} (${w.games.toLocaleString("en-US")})`;

/** Pre-registered tests and where they stand (details in docs/MODEL_CARD.md). */
const TESTS = [
  ["15-game blend toward this season", "Shipped (baseline)"],
  ["Minutes trend", "Shipped: held-out −0.052 FP/game"],
  ["Vegas game environment (team totals)", "Shipped: held-out −0.028 FP/game"],
  ["Minutes × per-minute rate", "Shipped: held-out −0.038 FP/game"],
  ["Opponent defense by position", "Shipped: held-out −0.010 FP/game"],
  ["Minutes × rate for players ESPN didn't project", "Shipped: held-out −0.463 FP/game"],
  ["Opponent defense per stat", "Not shipped: held-out +0.004 FP/game (worse)"],
  ["Teammate absences (boost, then minutes)", "Not shipped: worse even in exploration"],
  ["DARKO in the blend", "Collecting: judged on logged games (below)"],
  [
    "Win probability: variance model",
    "Did not ship (Brier 0.0831 vs 0.0778); recalibration after week 13",
  ],
];

export default async function ModelPage() {
  if (!dbConfigured()) {
    return <ErrorNotice title="Model accuracy needs the database" message="Set DATABASE_URL." />;
  }
  const [accuracy, blend, darko] = await Promise.all([
    currentAccuracy(etDate()),
    blendSetting(),
    darkoSetting(),
  ]);
  const e = blend?.evaluation ?? null;
  const d = darko?.evaluation ?? null;
  return (
    <>
      <PageHeader
        title="Model accuracy"
        subtitle="How far each projection has missed, game by game, this season"
      />

      <section className="space-y-1.5">
        <SectionTitle aside="Average miss in fantasy points per game (games scored)">
          Projection sources
        </SectionTitle>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-medium">Source</th>
                <th className="px-3 py-2.5 text-right font-medium">Last 7 days</th>
                <th className="px-3 py-2.5 text-right font-medium">Last 30 days</th>
                <th className="px-3 py-2.5 text-right font-medium">Season</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {accuracy.map((a) => (
                <tr key={a.source}>
                  <td className="px-3 py-2.5 font-medium">{LABEL[a.source]}</td>
                  <td className="px-3 py-2.5 text-right">{cell(a.last7)}</td>
                  <td className="px-3 py-2.5 text-right">{cell(a.last30)}</td>
                  <td className="px-3 py-2.5 text-right">{cell(a.season)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          Lower is better. Every evening before tip, the app logs our projection, ESPN&apos;s and
          the Vegas-implied one for every player with a game; the next morning&apos;s box scores
          score them. Vegas only covers players with posted props, so compare it to ours on the
          blend test below (same games). DARKO is its free daily projection, as of the morning.
        </p>
        <p className="px-1 text-xs text-muted-foreground">
          DARKO blend test (same rules as Vegas&apos;):{" "}
          {darko
            ? d
              ? `${d.ships ? "passed" : "did not pass"}: weight ${d.weight}, held-out days ${d.test.blend.mae.toFixed(2)} vs ours ${d.test.model.mae.toFixed(2)} (${d.test.games} games).`
              : `collecting, ${darko.collected.games} games over ${darko.collected.days} days so far.`
            : "waiting for the first nightly check."}
        </p>
      </section>

      <section className="space-y-1.5">
        <SectionTitle>The number under each score</SectionTitle>
        {blend?.ships ? (
          <Callout tone="info">
            The props blend passed its pre-registered test: for players with Vegas lines the app
            shows and uses {(100 - blend.weight * 100).toFixed(0)}% our model +{" "}
            {(blend.weight * 100).toFixed(0)}% Vegas (refit nightly).
            {e && (
              <>
                {" "}
                On the held-out days it missed by {e.test.blend.mae.toFixed(2)} vs ours{" "}
                {e.test.model.mae.toFixed(2)} ({e.test.games} games).
              </>
            )}
          </Callout>
        ) : (
          <Callout tone="info">
            Our model, until the Vegas blend passes its pre-registered test (7 game days and 800
            games with props; weight fitted on the first half, judged on the second).{" "}
            {blend
              ? `So far: ${blend.collected.games} games over ${blend.collected.days} days${
                  e
                    ? `; last check: ${e.ships ? "passed" : "did not pass"} (weight ${e.weight})`
                    : ""
                }.`
              : "Waiting for the first nightly check."}
          </Callout>
        )}
      </section>

      <section className="space-y-1.5">
        <SectionTitle>Pre-registered tests</SectionTitle>
        <div className="divide-y overflow-hidden rounded-xl border bg-card text-sm">
          {TESTS.map(([name, status]) => (
            <div key={name} className="flex items-baseline justify-between gap-3 px-3 py-2.5">
              <span className="font-medium">{name}</span>
              <span className="text-right text-xs text-muted-foreground">{status}</span>
            </div>
          ))}
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          A change to the model ships only after it beats the current one on data it wasn&apos;t
          tuned on, with the rule written down before the test runs (docs/MODEL_CARD.md).
        </p>
      </section>
    </>
  );
}
