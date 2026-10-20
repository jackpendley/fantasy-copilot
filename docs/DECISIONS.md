# Decisions

## ADR-001: one monorepo, NBA first (2026-10-18)

- **Why:** the draft tools, the webapp and later sports share the ESPN client, league scoring, the lineup optimizer and valuation. Separate repos had already drifted (the hoops draft tool is a fork of the football one).
- **Order:** NBA is built until it is complete. Then NFL (import `espn-draft-copilot` with history, plus a companion app), then MLB (import `Fantasy-Baseball-Insight-Tool` with history).
- **Deployments stay separate:** the baseball app keeps its own deployment and password, because a co-manager uses it.
- **Gate:** the baseball repo is private today, so its history gets a secret scan and Jack's approval before it becomes public.

## ADR-002: web stack = the baseball app's (2026-10-18)

- Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui, recharts.
- Supabase Postgres, accessed through the service role from the server only. RLS is enabled with no policies.
- Shared-password session auth, deployed on Vercel.
- **Why:** proven in Jack's baseball app, and the fastest path to a working app before opening night.

## ADR-003: scheduling with Supabase pg_cron (2026-10-18). Superseded by ADR-010

- **Why:** Vercel Hobby crons run once a day, which is too slow for late scratches.
- **How:** `pg_cron` + `pg_net` call `/api/cron/[job]` (bearer `CRON_SECRET`):
  - every 5 minutes from 90 minutes before the first tip until the last tip;
  - hourly otherwise.
- Nightly Python jobs run on GitHub Actions (free on a public repo). Vercel's daily cron is a fallback.

## ADR-004: ESPN writes are "suggest, then one-click apply" (2026-10-18)

- **Default:** the app computes the moves. Jack confirms, then the app submits them. Only players whose games haven't started are moved, and every write is audited.
- **Autopilot** (unattended writes) is a later, opt-in feature with a kill switch.

## ADR-005: free data first; measure before paying (2026-10-18)

- **Core sources:**
  - ESPN fantasy API;
  - ESPN site API (scoreboard, injuries, game summaries with shot coordinates and DraftKings lines);
  - NBA.com daily lineups JSON;
  - NBA official injury report PDFs.
- **Blocked:** stats.nba.com/stats and cdn.nba.com block datacenter IPs.
- **Paid candidates:** The Odds API player props, BALLDONTLIE, RotoWire, SportsDataIO. They're considered only after `news_latency` and model ablations show they would win points.

## ADR-006: ML in Python, served in TypeScript (2026-10-18)

- **Training:** `apps/nba-ml` (Python 3.11, polars, LightGBM, scikit-learn, psycopg) trains with walk-forward splits and pre-registered gates, following MarketScope's ADR-025 pattern.
- **Serving:** nightly predictions go to Postgres. For intraday late news, LightGBM models are exported as JSON and evaluated by a TypeScript tree evaluator, with a parity test against Python.

## ADR-007: lineup optimizer = exact assignment (2026-10-18)

- Every rostered player is assigned a slot (starting, bench or IR) by the Hungarian algorithm.
- The objective is projected points first, then the fewest moves.
- Locked players have only their current slot.
- **Why:** greedy matching is optimal for points, but not for minimizing moves, locks and IR together. The exact solver handles all of them, and at this size it takes microseconds.

## ADR-008: Phase 1 pages read live sources; the database comes with history (2026-10-18)

- **How:** `/today` and `/week` call ESPN (league, NBA schedule, scoreboard, injuries) on each request. That's a handful of parallel fetches at ~100–300 ms each, with the NBA schedule cached in memory for 6 hours.
- **Why:** the app works on opening night as soon as the ESPN cookies are set, with no schema or sync jobs to break.
- **Next:** Supabase arrives in Phase 2, where history is needed: write audit, alerts, `news_latency`, then the warehouse.
- **Dev override:** `ESPN_LEAGUE_FILE` renders the pages from a saved league JSON, for checks without cookies.

## ADR-009: ESPN write safety (2026-10-18)

- **Verified on basketball:** a two-item `ROSTER`/`LINEUP` transaction swapped two players on scoring period 1, and a second one restored them. Both returned `EXECUTED`, and a re-read confirmed each.
- **Server-side checks:** `/api/lineup/apply` reloads ESPN and recomputes the moves, then **refuses (409 "stale") unless they equal what the user confirmed**. The client never dictates moves.
- **Audit:** writes require an audit sink. That's Supabase `espn_actions`, or a local JSONL file in development. Production without Supabase refuses writes.
- **Disabled modes:** writes are disabled while `ESPN_LEAGUE_FILE` is set.
- **No blind retries:** ESPN has no idempotency key. On a lost response, the UI refreshes and shows what ESPN actually has.
- **Unverified:** whether ESPN accepts changes for future days. Football rejects non-current periods (`TRAN_INVALID_SCORINGPERIOD_NOT_CURRENT`). The UI surfaces ESPN's code if so.

## ADR-010: plain Postgres (Neon free) + an external scheduler; supersedes ADR-003 (2026-10-19)

- **Why not Supabase:** its free plan allows 2 active projects across all organizations Jack owns, and MarketScope and Pokemon-TCGP-DB use both. Jack rejected sharing either project's database and paying for Pro for a few tables.
- **Database:** any Postgres reached through `DATABASE_URL` with the `postgres` client (`prepare: false` for poolers). In production that's **Neon's free plan**, created from Vercel → Storage.
  - Schema: `apps/web/db/migrations/*.sql`, applied by `pnpm db:migrate` (a `schema_migrations` table records what ran).
  - Only server code connects, so there is no RLS layer.
- **Scheduling:** Neon scales to zero and has no pg_cron. Timed jobs are called by a free external scheduler (cron-job.org) at `/api/cron/[job]` with `Authorization: Bearer CRON_SECRET`, every 5 minutes in game windows. Vercel's daily cron remains a fallback.
- **Size:** big ML data (box scores, shots) lives in local Parquet files (MarketScope pattern). Only small app tables go in Postgres, well under Neon's 0.5 GB.

## ADR-011: one web app with a section per sport (2026-10-19)

- **What:** `apps/nba-manager` became **`apps/web` ("Fantasy Copilot")**. NBA pages live under `/nba/*`, and NFL and MLB will be sibling sections sharing login, alerts, the database and the league switcher.
- **Back-compat:** `/today` and `/week` redirect, so existing bookmarks and the phone home-screen icon keep working.
- **Code layout:** shared code lives in `lib/`, sport code in `lib/<sport>/`, and sport-agnostic logic moves into `packages/*`. No generic sport-plugin layer until a second sport exists.
- **Draft tools:** they stay per-sport extensions (`apps/draft-nba`; later `apps/draft-nfl`). Shared draft modules move to `packages/draft-core` when NFL arrives.
- **Repo history:** the original `~/Projects/espn-hoops-copilot` folder (no git history) is archived after Chrome loads the monorepo copy.

## ADR-012: migrations run on production deploys (2026-10-19)

- **How:** `apps/web`'s `build` runs `scripts/migrate.ts --production-only` before `next build`. It applies pending `db/migrations/*.sql` only when `VERCEL_ENV=production`.
  - Local, CI and preview builds skip it, so unmerged branches never touch the live database.
- **Why:** the schema always matches the deployed code, and the Neon connection string never has to leave Vercel.
- **Database:** the Neon `fantasy-copilot` database (Free, Washington D.C. iad1) is connected to the Vercel project as `DATABASE_URL` for Production and Preview. Previews share it, which is fine because previews never migrate.

## ADR-013: season outlook = the v3 sim in TypeScript, nightly (2026-10-19)

- **Code:** `packages/fantasy-core/src/sim.ts` ports the calibrated v3 sim and is driven by live inputs (`apps/web/lib/nba/outlook.ts`).
- **Parity:** on the draft-day files it reproduces the scratch sim within Monte Carlo noise. Jack: 12.7 wins, 90% playoffs, 24.6% title, against 12.7, 91% and 22.8% originally.
- **Actual results:** completed weeks keep ESPN's actual winner. The current week starts from the points already scored, and only the remaining days are simulated.
- **Manager activity:** this season's `transactionCounter` (lineup moves, adds), blended with last season's for the same owner. The prior weighs 21 days; new owners get a neutral prior (0.7, 0.6/wk). It's read from ESPN, so nothing private goes in git.
- **Schedule:** Vercel cron runs `/api/cron/nightly` at 11:00 UTC (4 AM in Arizona, before games). The page also has a "Run now" button. Runs are stored in `outlook_runs` for the odds-over-time chart. 800 seasons take ~11 s.

## ADR-014: waivers & streaming = re-run the week with the swap (2026-10-19)

- **Method:** for each shortlisted free agent (top 45 by fppg × games this week, plus the top 10 by rest-of-season value) and each drop candidate (the 5 lowest rest-of-season values among droppable players, or none with an open spot), re-run the week projection, i.e. the daily lineup optimizer for every remaining day.
  - The change in projected points becomes a change in P(win this week), using the same model and baseline as `/nba/week` (`lib/nba/matchup.ts`).
- **Timing:** a waiver player counts only from the day his claim processes. A player whose game already tipped today counts from tomorrow. Players in a game in progress are never dropped.
- **Two lists:**
  - **This week**: raises P(win), with the drop that helps most now.
  - **Long term**: rest-of-season gain above 50 points, with the drop that keeps the most value, and this week's cost shown.
- **Writes:** `/api/waivers/add` re-checks against fresh ESPN data before writing:
  - the player is still available, with the same free-agent/waiver status;
  - the drop is still rostered and not locked;
  - an add is left (free agents only).
  - It then sends a `FREEAGENT` add or a `WAIVER` claim, audited as `add-drop` or `waiver-claim`.
  - There's no zero-impact test for adds (a drop can't be undone), so **Jack's first real claim or add is the live test of this path**.

## ADR-015: players & trends from free ESPN sources (2026-10-19)

- **Game logs:** ESPN's public athlete game log (`site.web.api.espn.com/.../athletes/{id}/gamelog`), no cookies. Athlete ids match fantasy ids.
  - Each game is scored with the league's own scoring map, so player pages show _league_ fantasy points.
  - Season averages are regular season only. "Last 5" includes playoffs.
  - Before a player's first regular-season game, the page shows last season's log and says so.
- **Trends:**
  - **Hot & cold:** ESPN's last-7-day average vs projection, with at least 2 games in the window.
  - **Free agents being added:** ESPN ownership change.
  - **Minutes opening up:** a rule, not a model. For each NBA team with a projected 28+ FP/G player ruled out, list the healthy free agents on that team who share a position group (G/F/C).
- **Usage rate is not shown.** The free game log doesn't include it, and it won't be estimated. It comes later with the data warehouse.

## ADR-016: live matchup from ESPN's own live scoring (2026-10-19)

- **Scores come from ESPN:**
  - **Week totals:** `totalPointsLive`, falling back to `totalPoints`.
  - **Today's per-player points and slots:** the `mBoxscore` view (`rosterForCurrentScoringPeriod`).
  - Box scores aren't re-scored. ESPN's numbers are what decide the matchup.
- **Projection during games:**
  - Banked points already include the part of each game played.
  - A starter in a game in progress adds `value × (1 − share of regulation played)`, from the scoreboard's quarter and clock. Overtime counts as finished.
  - Players who haven't tipped add the best-lineup projection, as before.
  - This fixes Week and Waivers too: they previously used `totalPoints` and ignored games in progress.
- **Odds through the week:** the nightly job (11:00 UTC, before games) writes a row to `matchup_snapshots` (migration 0003). The chart shows those, plus "now" once today's games start.
- **Refresh:** the page re-renders every 60 s while a game is live and the tab is visible. No push or websocket.
- **Nav:** "Week" is now labeled **Matchup** (same URL, `/nba/week`), to keep the phone tab bar at 6 tabs.

## ADR-017: trades judged by starting-lineup points, then simulated (2026-10-19)

- **Team value:** projected starting-lineup points for the rest of the season. For every remaining day, take the best lineup from the players with a game, each worth `fppg × min(1, projected games / 82)`.
  - Regular season and playoff weeks are kept separate.
  - Each distinct set of players playing is solved once (memoized), so a team value takes about 5 ms.
  - This captures what raw totals miss: positional fit, schedule overlap, and bench players who never start.
- **Analyzer:** shows the change in starting points for both sides, plus the raw rest-of-season gap (what most managers look at).
  - **"Simulate"** runs the season simulator with and without the trade: 500 seasons each, same seed. It's read-only and runs on demand (~10–30 s).
  - Changes under ~2 points are noise, and the page says so.
- **Target finder:** every 1-for-1 deal with every team (~1,600 pairs, ~5 s, streamed into the page). A deal must:
  1. raise Jack's starting points, ranked by regular-season points plus playoff-week points counted twice;
  2. send the partner at least 95% of the raw season points they give up;
  3. not cost the partner's lineup more than 50 points.
- **Power rankings** order teams by starting points per remaining regular-season week. Playoff and title odds come from the latest nightly outlook run.
- **Navigation:** a League tab (standings → team → trades). On phones, Settings moved to a header gear, so the tab bar stays at 6.
- **Not yet:** 2-for-1 targets, or manager tendencies (who accepts trades, what they value).

## ADR-018: live stat lines and a fixed pregame projection (2026-10-20)

- **Box scores:** each player's box score comes from ESPN's `mBoxscore` view (`stats` entry: source 0, split 5, keyed `"05"+gameId`). It's the same source as the live points, so the two always agree.
- **Fixed pregame projection:** `perGameProjection(p, asOf)` ignores games from the `asOf` scoring period on. ESPN folds a game into the season line as soon as it's played; without this, a player's "projection" would chase his own game.
  - The day board and the week projection pass today's period.
  - Example: Tatum scored 8 on opening night, and his pregame projection stayed 34.0.
- **Updated projection while live:** points so far + pregame × unplayed share of regulation. Once final, the pregame projection is shown under the final score.
- **Arrows (▲/▼):** shown when the updated (or final) number is at least 5 points **and** 20% away from the pregame projection. Small projections need the 5 points; big ones need the 20%.
- **Assumption, to confirm during a live game:** ESPN's season line already includes a game in progress. If it doesn't, the pregame projection only dips during that game and is right again at the final.

## ADR-019: trades v2: market value for the partner, lineup points for Jack, up to 3-for-3 (2026-10-20)

- **Why:** v1 judged fairness with the same projections it optimized. In this league's scoring, ESPN projects Jaylen Brown (24.0 FP/G) below John Collins (24.6), so v1 called Collins-for-Brown fair. No manager would take it: Brown is ADP 34 / $20, Collins ADP 113 / $2.
- **Market value** (`lib/nba/market.ts`), in auction dollars:
  - **Preseason:** the average of ESPN's average auction price, ESPN's own dollar value, and this league's draft slot converted to dollars on the ESPN price curve.
  - **In-season:** shifts toward the player's in-season rank: ESPN's when published, else by FP/G with 3+ games. Weight = games / (games + 20).
  - Dollars are convex, which prices stars correctly.
- **Acceptance:**
  - The partner must get ≥95% of the market value they send.
  - +10% when they give up the deal's best player for more players (consolidation premium).
  - Realism tiers: **likely** (≥105% and their lineup gains), **fair**, **long shot**.
  - Targets show likely and fair only.
- **Jack's side:**
  - Starting-lineup points, regular season + 2× playoff weeks, as before.
  - Jack never sends more than ~125% of the market value he gets. When market and projection disagree that much, the projection may be the one that's wrong.
  - Example: the market prices Tatum like a top-10 player, while ESPN's projection in this scoring is 34 FP/G.
- **Uneven trades** (`applyTrade`): the side getting more players drops its lowest rest-of-season values. The side getting fewer adds the best free agents (never the same one twice). The simulator uses the same balancing.
- **Search:**
  - Each roster's top 10 by market value; every subset pair up to 3-for-3 that could pass the market check.
  - A quick estimate (each player's marginal lineup value), then the exact evaluation of the best 40 per size and partner.
  - Filters: drop deals where anyone cuts a player they just received; merge deals that differ only by throw-ins (<$3); at most 2 ideas per size built on the same outgoing star; 8 per size.
- **Speed:** lineups use the exact greedy (transversal matroid) from the simulator (`greedyStarters`, tested equal to the Hungarian optimizer). The whole search takes ~1.5 s, so it runs live, streamed into the page. This replaces the planned nightly table and second cron.

## ADR-020: steadier outlook: common random numbers, 2,000 seasons, "What changed" (2026-10-20)

- **Why:** Jack's title odds fell from 20% to 15% overnight (Oct 19→20) before any game. Diagnosis:
  - ESPN projections and statuses were unchanged.
  - Two rivals improved through waivers: 3reee added Toumani Camara, Lakers in 5 added Ingram and Fears.
  - The rest was simulation noise: 800 seasons gives about ±1.5 points per run. Worse, any roster change shifted the single random stream for everyone.
- **Common random numbers:** each draw is a hash of (seed, season, player or team, day or week, purpose) via `keyedUniform`, not the next number in a stream.
  - Test: adding a player who never plays leaves every team's odds exactly unchanged.
  - On live data, swapping one bench player moved other teams by at most 0.7 points.
- **2,000 seasons** (about ±0.9 points): ~29 s locally for the simulation, ~32 s for a full run. It fits the 300 s nightly budget.
- **"What changed" on Outlook:** teams whose title odds moved ≥1 point, next to the roster moves between the two runs (`mTransactions2`: waivers, free agents, trades), each valued in rest-of-season points.
