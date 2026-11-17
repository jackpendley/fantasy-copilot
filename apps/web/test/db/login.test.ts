// The login route's lockout against a real Postgres (test/db/test-db.ts). Addresses and the
// password are synthetic. Truncates only login_attempts (other files share the database).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { testDatabaseUrl } from "./test-db";

const url = testDatabaseUrl();
if (url) process.env.DATABASE_URL = url;
process.env.APP_PASSWORD = "synthetic-pw";
process.env.SESSION_SECRET = "synthetic-session-secret";

const { db } = await import("@/lib/db");
const { POST } = await import("@/app/api/login/route");
const { MAX_FAILURES } = await import("@/lib/login-guard");

const attempt = (password: string, ip = "203.0.113.7") =>
  POST(
    new NextRequest("http://x/api/login", {
      method: "POST",
      headers: { "x-forwarded-for": ip, "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  );

describe.skipIf(!url)("the login lockout (Postgres)", () => {
  beforeEach(async () => {
    await db()`truncate login_attempts`;
  });
  afterAll(async () => {
    await db().end();
  });

  it("refuses an address after too many wrong passwords, even with the right one", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect((await attempt("wrong")).status).toBe(401);
    const locked = await attempt("synthetic-pw");
    expect(locked.status).toBe(429);
    const wait = Number(locked.headers.get("retry-after"));
    expect(wait).toBeGreaterThan(14 * 60);
    expect(wait).toBeLessThanOrEqual(15 * 60);
    // Another address isn't affected.
    expect((await attempt("synthetic-pw", "203.0.113.8")).status).toBe(200);
  });

  it("lets an address in once its failures are older than the window", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await attempt("wrong");
    await db()`update login_attempts set at = now() - interval '16 minutes'`;
    const ok = await attempt("synthetic-pw");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain("fc_auth=");
  });

  it("clears an address's count on the right password", async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) await attempt("wrong");
    expect((await attempt("synthetic-pw")).status).toBe(200);
    const [r] = await db()`select count(*)::int as n from login_attempts`;
    expect(r!.n).toBe(0);
    expect((await attempt("wrong")).status).toBe(401);
  });

  it("drops failures older than a day", async () => {
    await db()`insert into login_attempts (ip, at) values ('198.51.100.1', now() - interval '2 days')`;
    await attempt("wrong");
    const rows = await db()`select ip from login_attempts`;
    expect(rows.map((r) => r.ip)).toEqual(["203.0.113.7"]);
  });
});
