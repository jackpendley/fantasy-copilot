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
