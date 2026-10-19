# Project status (2026-10-18)

## Where things stand

- **Phase 0 nearly done.**
- **The workspace builds:**
  - `fantasy-core` (14 tests), `espn` (9), `nba-data` (7) and `draft-nba` (118) all pass.
  - `pnpm test:sources` passes for every public source.
- **Post-draft season sims** are preserved in `apps/draft-nba/scripts/postdraft/`. Their private inputs are in gitignored `data/local/postdraft/`.

## Blockers (Jack)

- **Supabase project `fantasy-copilot`:** create it, then put the URL, service-role key and `DATABASE_URL` in `apps/nba-manager/.env.local`.
- **ESPN cookies** (`ESPN_S2`, `ESPN_SWID`) in the same file.

## Next task

- **Phase 1:** scaffold `apps/nba-manager`, apply schema v1, and add the sync jobs and `/today`.
- **Deadline:** before the first tip, Tue Oct 20 at 12:00 PM MST (DET vs BOS: Tatum, Duren, Collins).
