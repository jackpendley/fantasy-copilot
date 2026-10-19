# Roadmap: NBA first

**Goal:** win the league. The edge comes from:

- better daily lineups and streaming;
- better in-season projections (data + ML);
- trades;
- reacting to late news faster than the other managers.

NFL comes once the NBA app is fully built, then MLB.

## Phase 0: monorepo setup

- [x] pnpm workspace, TypeScript base, ESLint/Prettier, Vitest
- [x] `apps/draft-nba`: hoops draft extension moved in (118 tests pass) and post-draft season sims preserved
- [x] `packages/fantasy-core`: league scoring, availability priors, exact lineup optimizer (Hungarian; brute-force-checked)
- [x] `packages/espn`: read client + parsers (settings, teams/rosters, matchups, NBA schedule)
- [x] `packages/nba-data`: ESPN scoreboard/injuries, NBA.com daily lineups, name matching, `pnpm test:sources`
- [x] GitHub repo (public) and CI
- [x] Vercel project (Jack). Database: Neon free via Vercel (ADR-010)

## Phase 1: lineup MVP (before the first tip, Tue Oct 20 12:00 PM MST)

- [x] `apps/web` scaffold: shadcn, password auth (Supabase schema moved to phase 2, ADR-008)
- [x] Live loaders: ESPN league/rosters/locks, NBA schedule and tip times, ESPN injuries
- [x] `/today` and any other day: games, injuries, projected points, recommended slots, exact moves
- [x] `/week`: games grid, my projected total vs my opponent's, win chance
- [ ] Deploy behind the password

## Phase 2: game-day edge (week 1)

- [x] Schema v1 + `pnpm db:migrate` (tested on local Postgres 17); apply to Neon once created

- [x] ESPN write verified 2026-10-18: zero-impact swap + restore on sp 1, both `EXECUTED`
- [x] One-click "Apply moves" (server recomputes, refuses stale, audit required; local JSONL until the database exists)
- [x] NBA.com daily lineups on /today: starter badges, inactive -> 0 projected
- [x] `status_events` logging (ESPN injuries, ESPN fantasy, NBA.com lineups) in the game window
- [ ] Official injury report PDFs (moved to phase 4: parsed in Python with the warehouse)
- [x] Questionable-player hedging: later-tipping bench backup on Today + alert
- [x] PWA + web push alerts: lineup not optimal at T−30, a starter ruled OUT, hedge reminder, ESPN login expired; /settings
- [ ] Production push keys in Vercel + cron-job.org calling /api/cron/gameday every 5 min (Jack)

## Phase 3: waivers and streaming (weeks 1–2)

- [ ] Free-agent sync, 3-adds/week budget
- [ ] Net added starts per candidate (optimizer run for each remaining day)
- [ ] Drop candidates, IR, trends; one-click add/drop with a named-drop confirm
- [ ] Rank by ΔP(win this week)

## Phase 4: data warehouse (weeks 1–3)

- [ ] Backfill 2023-24 to 2025-26: ESPN summaries (box, shots with coordinates, lines), lineups, injury PDFs
- [ ] Nightly ingestion; fantasy-points parity vs ESPN `appliedTotal`
- [ ] Player pages: rolling fantasy points, minutes, usage, TS%, per-36

## Phase 5: ML models (weeks 3–6)

- [ ] Minutes (LightGBM quantiles) · Availability (P(play)) · Production rate (empirical Bayes) · Expected shooting (xFG)
- [ ] Combined per-game distribution; nightly rest-of-season projections; TypeScript GBM serving with parity test
- [ ] `MODEL_CARD.md`; promote each model only after it passes its gate

## Phase 6: trades (weeks 5–7)

- [ ] Analyzer: Δ rest-of-season points, lineup fit, ΔP(playoffs/title) for both sides
- [ ] Target finder: mutually plausible 1-for-1 and 2-for-1 deals, manager profiles

## Phase 7: league intelligence (week 6+)

- [ ] Standings, live matchup win probability, weekly power rankings and playoff odds (v3 sim)
- [ ] Opponent scouting; playoff-schedule planner
