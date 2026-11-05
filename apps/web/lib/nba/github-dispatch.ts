import "server-only";
// Start the simulation worker (.github/workflows/simulate.yml) right away instead of waiting
// for its 5-minute schedule. Needs GITHUB_DISPATCH_TOKEN: a fine-grained token limited to this
// repository's Actions (read and write). Without it the schedule picks the work up.

import { db } from "@/lib/db";

const REPO = process.env.GITHUB_REPOSITORY || "jackpendley/fantasy-copilot";

/**
 * True when GitHub accepted the request. At most one dispatch a minute: a roster move asks
 * for a job build and a trade search at once, and a second run would only queue behind the
 * first (the workflow runs one at a time) and idle.
 */
export async function dispatchWorker(): Promise<boolean> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return false;
  const fresh = await db()`
    insert into job_locks (name, until) values ('worker-dispatch', now() + interval '60 seconds')
    on conflict (name) do update set until = excluded.until where job_locks.until < now()
    returning name
  `;
  if (!fresh.length) return false;
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/simulate.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );
  return res.status === 204;
}
