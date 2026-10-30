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
- [x] Official injury report PDFs: parsed in TypeScript (`packages/nba-data`), logged live from 9 AM on game days
- [x] Questionable-player hedging: later-tipping bench backup on Today + alert
- [x] PWA + web push alerts: lineup not optimal at T−30, a starter ruled OUT, hedge reminder, ESPN login expired; /settings
- [ ] Production push keys in Vercel + cron-job.org calling /api/cron/gameday every 5 min (Jack)

## Phase 3: waivers and streaming (weeks 1–2)

- [x] Free-agent pool (waivers vs free agents), 3-adds/week budget from ESPN's weekly counter
- [x] Net added starts and points per candidate (week re-run with each add/drop pair)
- [x] Drop candidates, ownership trend; one-click add/drop or waiver claim with a named-drop confirm (first live use pending)
- [x] Ranked by ΔP(win this week); separate long-term list (ADR-014)

## Phase 4: data warehouse (weeks 1–3)

- [ ] Backfill 2023-24 to 2025-26: ESPN summaries (box, shots with coordinates, lines), lineups, injury PDFs
- [ ] Nightly ingestion; fantasy-points parity vs ESPN `appliedTotal`
- [x] Player pages: league fantasy points by game, 5-game rolling average, minutes, game log (usage/TS%/per-36 wait for the warehouse; ADR-015)
- [x] Trends: hot & cold vs projection, ownership risers, minutes opening up behind injured starters

## Phase 5: ML models (weeks 3–6)

- [ ] Minutes (LightGBM quantiles) · Availability (P(play)) · Production rate (empirical Bayes) · Expected shooting (xFG)
- [ ] Combined per-game distribution; nightly rest-of-season projections; TypeScript GBM serving with parity test
- [x] `MODEL_CARD.md` and walk-forward backtest harness; minutes trend passed a held-out season and ships
- [x] Minutes × rate projection and opponent defense by position passed held-out tests and ship (ADR-034, ADR-036); teammate-absence minutes failed
- [x] Unprojected players' minutes × rate passed and ships; opponent defense per stat failed (ADR-037)
- [x] Availability: fitted chances from three seasons of official reports failed the held-out gate against simple per-status chances (ADR-038)
- [ ] Promote each further model only after it passes its gate (collecting: official statuses vs ESPN, forward; DARKO in the blend)

## Phase 6: trades (weeks 5–7)

- [x] Analyzer: Δ starting-lineup points (regular season and playoff weeks) for both sides, raw-value gap, ΔP(playoffs/title) by seeded simulation (ADR-017)
- [x] Target finder: mutually plausible 1-for-1 deals across the league
- [x] Multi-player targets up to 3-for-3 with market-value acceptance and roster balancing (ADR-019)
- [ ] Manager profiles (who trades, what they value)

## Phase 7: league intelligence (week 6+)

- [x] Live matchup: ESPN live points per player, in-game remainders, both teams' starts by day, daily win-chance snapshots (ADR-016)
- [x] Standings and power rankings (lineup strength per week), team pages with rosters
- [ ] Opponent scouting; playoff-schedule planner
