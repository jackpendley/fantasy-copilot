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

/** Drop every remembered response (after an ESPN write). */
export function forgetResponses() {
  entries.clear();
}
