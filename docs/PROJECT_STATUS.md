# Project status (2026-10-19)

## Where things stand

- **Phases 0, 1 and 2a are on `main`:**
  - monorepo and packages;
  - `/today` and `/week`;
  - one-click ESPN apply, audit-gated; the write path was verified on Jack's team on 10/18;
  - NBA.com lineups;
  - plain-Postgres schema and migrations.
- **PR #4 is merged** and live at fantasy-copilot-nba.vercel.app. Root Directory is `apps/web`, and the first production build applied `0001_schema.sql` to Neon:
  - `apps/nba-manager` → `apps/web` ("Fantasy Copilot"), NBA pages under `/nba/*`, with `/today` and `/week` redirects (ADR-011);
  - VS Code workspace settings;
  - migrations on production deploys (ADR-012).
- **Database:** Neon `fantasy-copilot` (Free, iad1) is created and connected to Vercel as `DATABASE_URL`. Empty `DATABASE_URL`/`SUPABASE_*` placeholders were removed from Vercel with Jack's OK.
- **Browser access:** works in this session (Claude in Chrome).

## Blockers / Jack

1. **After PR #4 merges:** Vercel → fantasy-copilot-nba → Settings → Build and Deployment → Root Directory = `apps/web`, then Redeploy. That first production build applies the schema.
2. **Chrome:** `chrome://extensions` → remove the old unpacked "Hoops Draft Copilot" → **Load unpacked** → `~/Projects/fantasy-copilot/apps/draft-nba/extension`. Then confirm, so the old `~/Projects/espn-hoops-copilot` can be zipped to `~/Projects/_archive` and removed.
3. **Optional for local DB work:** paste the Neon `DATABASE_URL` (Vercel → Storage → fantasy-copilot → .env.local → Copy Snippet) into `apps/web/.env.local`.

## Next tasks

1. **Phase 2b:** `status_events` logging, push alerts (PWA), cron routes driven by cron-job.org, questionable-player hedging.
2. **Phase 3:** `/nba/outlook`, the season sim ported to TypeScript, nightly odds for playoffs, #1 seed and the title.
