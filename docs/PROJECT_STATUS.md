# Project status (2026-10-19, afternoon)

## Where things stand

- **Live** at fantasy-copilot-nba.vercel.app: Today, Week, Settings; Outlook once PR #7 deploys.
- **Phase 2b is merged (PR #6):**
  - game-day alerts (starter out, lineup not optimal at T−30, hedge reminder, login expired);
  - `status_events` logging;
  - web push (PWA, `/settings`);
  - hedges on Today.
- **Phase 3 (PR #7):**
  - `/nba/outlook` with playoff, #1-seed, final and title odds and an odds-over-time chart;
  - nightly Vercel cron;
  - the TypeScript sim, matching the v3 sim within noise (ADR-013).
  - Checked end to end on a throwaway local Postgres with the live league: 2 runs at ~11 s each, page renders.

## Blockers / Jack

1. **Push keys in Vercel (needs OK, they're secrets):** `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. The values are in `apps/web/.env.local`. Redeploy after adding.
2. **5-minute game-day checks:** create a free cron-job.org account, then a job:
   - GET `https://fantasy-copilot-nba.vercel.app/api/cron/gameday`, every 5 minutes;
   - header `Authorization: Bearer <CRON_SECRET from .env.local>`.
3. **iPhone:** open the app from the home screen → Settings → Enable notifications → Send test.

## Next tasks

1. Merge PR #7, then tap "Run now" on `/nba/outlook` once (the nightly cron takes over from tomorrow).
2. **Phase 3b, waivers and streaming:**
   - free-agent pool (`parsePlayerPool` is ready);
   - net added starts with the optimizer;
   - ΔP(win this week);
   - one-click add/drop.
3. **Phase 4, data warehouse:** `apps/nba-ml` (Python), 2023-26 ESPN game summaries, injury PDFs.
