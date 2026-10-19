# Project status (2026-10-19)

## Where things stand

- **One app, a section per sport (ADR-011):**
  - `apps/web` ("Fantasy Copilot") with `/nba/today` and `/nba/week`.
  - `/today` and `/week` redirect.
  - Live at https://fantasy-copilot-nba.vercel.app. Its Vercel Root Directory must point at `apps/web` once the rename merges.
- **One-click apply:**
  - Built, and the ESPN write path was verified on Jack's team (zero-impact swap and restore, 2026-10-18).
  - Disabled in production until the database exists, because writes must be audited.
- **Database (ADR-010):** plain Postgres via `DATABASE_URL`; `pnpm db:migrate` was tested on local Postgres. Neon is not created yet.
- **Draft extension:** `apps/draft-nba` builds from the monorepo. Chrome still loads the old `~/Projects/espn-hoops-copilot` copy.
- **Tests:** espn 13, fantasy-core 14, nba-data 7, web 10, draft-nba 118, all passing.
- **CI:** GitHub Actions had an incident on 2026-10-19 that queued runs. Merge only after checks register and pass.

## Waiting on Jack

1. **Chrome:** at `chrome://extensions`, remove the old unpacked "Hoops Draft Copilot", then Load unpacked → `~/Projects/fantasy-copilot/apps/draft-nba/extension`. After that, Claude archives the old folder.
2. **Vercel:** set Root Directory to `apps/web` (Settings → Build & Deployment).
3. **Neon:** Vercel → Storage → Create → Neon (free), connected to the project. Copy the pooled `DATABASE_URL` into `apps/web/.env.local`.
4. **Claude in Chrome:** install or enable the extension, then run `/chrome` in the VS Code terminal session, so Claude has browser access.

## Next tasks

1. After Neon: `pnpm --filter @fantasy-copilot/web db:migrate`, redeploy; production apply works.
2. **Phase 2b:**
   - `status_events` logging (ESPN injuries, NBA.com lineups, official injury PDFs).
   - PWA + push alerts.
   - `/api/cron/[job]` + cron-job.org.
   - Questionable-player hedging.
3. **Phase 3:** `/nba/outlook`, the TypeScript port of `apps/draft-nba/scripts/postdraft/league-sim.mjs`, seeded with actual results. Nightly playoff, #1-seed and title odds, with a history chart.
