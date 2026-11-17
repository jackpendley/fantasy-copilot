// The worker's requests to the app (worker/worker.ts, apps/web/worker/tasks.ts): one failed
// request (a network error, a 5xx while the app deploys) shouldn't end a runner, which would
// strand the chunks or the task it holds.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn`; when it throws, wait and try again, once per entry of `waits` (ms). */
export async function retrying<T>(
  fn: () => Promise<T>,
  waits: number[] = [2_000, 8_000, 20_000],
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= waits.length) throw e;
      await sleep(waits[i]!);
    }
  }
}
