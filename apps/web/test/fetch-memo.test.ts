import { beforeEach, describe, expect, it } from "vitest";
import { forgetResponses, memoFetch } from "@/lib/fetch-memo";

function counter(status = 200) {
  let calls = 0;
  const base = (async () => {
    calls++;
    return new Response(JSON.stringify({ n: calls }), { status });
  }) as typeof fetch;
  return { base, calls: () => calls };
}

describe("memoFetch", () => {
  beforeEach(() => forgetResponses());

  it("reuses a response within the TTL and shares one call in flight", async () => {
    const c = counter();
    const f = memoFetch(60_000, c.base);
    const [a, b] = await Promise.all([f("https://x/a"), f("https://x/a")]);
    expect(await a.json()).toEqual({ n: 1 });
    expect(await b.json()).toEqual({ n: 1 });
    expect(await (await f("https://x/a")).json()).toEqual({ n: 1 });
    expect(c.calls()).toBe(1);
  });

  it("keys on the ESPN filter header", async () => {
    const c = counter();
    const f = memoFetch(60_000, c.base);
    await f("https://x/a", { headers: { "X-Fantasy-Filter": "1" } });
    await f("https://x/a", { headers: { "X-Fantasy-Filter": "2" } });
    expect(c.calls()).toBe(2);
  });

  it("refetches after the TTL and after forgetResponses", async () => {
    const c = counter();
    await memoFetch(60_000, c.base)("https://x/a");
    await memoFetch(0, c.base)("https://x/a");
    expect(c.calls()).toBe(2);
    forgetResponses();
    await memoFetch(60_000, c.base)("https://x/a");
    expect(c.calls()).toBe(3);
  });

  it("never keeps failures", async () => {
    const c = counter(401);
    const f = memoFetch(60_000, c.base);
    expect((await f("https://x/a")).status).toBe(401);
    await f("https://x/a");
    expect(c.calls()).toBe(2);
  });
});
