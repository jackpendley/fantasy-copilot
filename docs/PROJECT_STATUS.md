# Project status (2026-10-18, evening)

## Where things stand

- **Phase 0 is done.** The public repo is https://github.com/jackpendley/fantasy-copilot and CI is green.
- **Phase 1 is built** on branch `phase-1-lineup-mvp`:
  - `apps/nba-manager`: password login, `/today` (any date) and `/week`.
  - It was checked end to end against the real post-draft roster through the `ESPN_LEAGUE_FILE` override.
  - Opening night shows 2 moves for +24.6 projected points: Caleb Wilson F→BE (no game), John Collins BE→F.
- **Tests:** `fantasy-core` 14, `espn` 9, `nba-data` 7, `nba-manager` 9, `draft-nba` 118, all passing. `next build` passes.

## Blockers (Jack)

1. Create `apps/nba-manager/.env.local` with `ESPN_S2`, `ESPN_SWID`, `APP_PASSWORD`, `SESSION_SECRET` and `CRON_SECRET`.
   - Supabase values can wait until Phase 2.
2. **Vercel:** import `jackpendley/fantasy-copilot`.
   - Root Directory `apps/nba-manager`, framework Next.js.
   - Set the same env vars.

## Next tasks

1. Once the cookies are in: `pnpm test:sources` (private league check), then `pnpm dev` and confirm `/today` against the ESPN app.
2. Deploy before the first tip: **Tue Oct 20, 12:00 PM MST** (DET vs BOS).
3. **Phase 2:** Supabase schema, ESPN write test, one-click apply, lineups feed, alerts.
