import "server-only";
// Start the simulation worker (.github/workflows/simulate.yml) right away instead of waiting
// for its 5-minute schedule. Needs GITHUB_DISPATCH_TOKEN: a fine-grained token limited to this
// repository's Actions (read and write). Without it the schedule picks the work up.

const REPO = process.env.GITHUB_REPOSITORY || "jackpendley/fantasy-copilot";

/** True when GitHub accepted the request. */
export async function dispatchWorker(): Promise<boolean> {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return false;
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
