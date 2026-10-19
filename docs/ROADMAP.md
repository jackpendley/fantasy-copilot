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
- [ ] GitHub repo (public) and CI
- [ ] Supabase project + Vercel project (Jack)

## Phase 1: lineup MVP (before the first tip, Tue Oct 20 12:00 PM MST)

- [ ] `apps/nba-manager` scaffold: shadcn, password auth, Supabase schema v1
- [ ] Syncs: ESPN league/rosters/locks, NBA schedule and tip times, ESPN injuries
- [ ] `/today` and tomorrow: games, injuries, projected points, recommended slots, exact moves
- [ ] `/week`: games grid, my projected total vs my opponent's
- [ ] Deploy behind the password

## Phase 2: game-day edge (week 1)

- [ ] ESPN write test (harmless bench↔bench move), then one-click "Apply moves" with an `espn_actions` audit log
- [ ] Daily lineups feed + late scratches; official injury report PDFs; `news_latency` logging
- [ ] Questionable-player hedging (keep a later-tipping substitute)
- [ ] PWA + web push alerts: lineup not optimal at T−30, a starter ruled OUT, sync/cookie failure

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
