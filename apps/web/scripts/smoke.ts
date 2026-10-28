// Load every page of a running app and fail on any error (read-only: pages only read ESPN;
// the outlook page may start its own background re-run, as it does for any visitor).
//
//   pnpm --filter @fantasy-copilot/web smoke                       (http://localhost:3000)
//   SMOKE_URL=https://fantasycopilot.vercel.app pnpm --filter @fantasy-copilot/web smoke
//
// Signs in with a session cookie derived from SESSION_SECRET (.env.local); never prints it.

import { AUTH_COOKIE, sessionToken } from "../lib/auth";

const BASE = (process.env.SMOKE_URL || "http://localhost:3000").replace(/\/$/, "");
// Public ESPN ids: Jayson Tatum (a rostered player) and a team id in every 12-team league.
const PAGES = [
  "/nba/today",
  "/nba/week",
  "/nba/waivers",
  "/nba/players",
  "/nba/players/4065648",
  "/nba/outlook",
  "/nba/league",
  "/nba/league/1",
  "/nba/league/trades",
  ...["1-for-1", "2-for-1", "1-for-2", "2-for-2", "3-for-2", "2-for-3", "3-for-3"].map(
    (s) => `/nba/league/trades?size=${s}`,
  ),
  "/settings",
  // The player card's data (Tatum).
  "/api/players/4065648/card",
];
// Text the app renders when a page fails (ErrorNotice titles, Next's error page).
const FAILURE = [/Couldn&#x27;t load|Couldn't load/, /Application error/, /needs the database/];

async function main() {
  const cookie = `${AUTH_COOKIE}=${await sessionToken()}`;
  let failed = 0;
  for (const path of PAGES) {
    const t0 = Date.now();
    const res = await fetch(BASE + path, { headers: { cookie }, redirect: "manual" });
    const body = res.status === 200 ? await res.text() : "";
    const hit = FAILURE.find((re) => re.test(body));
    const ok = res.status === 200 && !hit;
    if (!ok) failed++;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${String(res.status).padEnd(3)} ${String(Date.now() - t0).padStart(5)} ms  ${path}${hit ? `  (${hit.source})` : ""}`,
    );
  }
  console.log(failed ? `\n${failed} page(s) failed` : `\nall ${PAGES.length} pages ok`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
