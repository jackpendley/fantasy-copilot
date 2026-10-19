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

## ADR-003: scheduling with Supabase pg_cron (2026-10-18)

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
