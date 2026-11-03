import "server-only";
// A fetch that remembers successful responses for a few seconds, per server instance. Every
// page loads the league, live pages refresh every 20 seconds, and moving between pages repeats
// the same ESPN reads; concurrent requests share one call in flight. Entries are keyed by URL
// plus the X-Fantasy-Filter header, and failures are never kept. After an ESPN write,
// forgetResponses() drops everything so the next read sees the change.

type Body = { status: number; text: string };
const entries = new Map<string, { at: number; body: Promise<Body> }>();
const MAX_ENTRIES = 200;

function respond({ status, text }: Body) {
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

/** A fetch whose successful responses are reused for `ttlMs`. */
export function memoFetch(ttlMs: number, base: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const filter = new Headers(init?.headers).get("x-fantasy-filter") ?? "";
    const key = `${String(input)} ${filter}`;
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return respond(await hit.body);

    const body = base(input, init).then(async (res) => ({
      status: res.status,
      text: await res.text(),
    }));
    entries.set(key, { at: Date.now(), body });
    if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
    const forget = () => {
      if (entries.get(key)?.body === body) entries.delete(key);
    };
    try {
      const b = await body;
      if (b.status < 200 || b.status >= 300) forget();
      return respond(b);
    } catch (e) {
      forget();
      throw e;
    }
  }) as typeof fetch;
}

const forgetters: (() => void)[] = [];

/** Also run `fn` whenever remembered responses are dropped (caches built from them). */
export function onForget(fn: () => void) {
  forgetters.push(fn);
}

/** Drop every remembered response (after an ESPN write), and what was built from them. */
export function forgetResponses() {
  entries.clear();
  for (const fn of forgetters) fn();
}

/**
 * Remember an async result for `ttlMs` by key, per server instance (the parsed league, so pages
 * and cards don't re-parse the same responses). Failures aren't kept; forgetResponses() clears.
 */
export function memoAsync<A extends unknown[], R>(
  ttlMs: number,
  key: (...args: A) => string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  const cache = new Map<string, { at: number; value: Promise<R> }>();
  onForget(() => cache.clear());
  return (...args: A) => {
    const k = key(...args);
    const hit = cache.get(k);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = fn(...args);
    cache.set(k, { at: Date.now(), value });
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
    value.catch(() => {
      if (cache.get(k)?.value === value) cache.delete(k);
    });
    return value;
  };
}
