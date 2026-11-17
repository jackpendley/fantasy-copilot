import "server-only";
// The login form's guard: the password is compared in constant time, and a client address
// with too many wrong passwords in a short window is refused for a while. The lockout is per
// address, so a stranger guessing can't lock Jack out. On Vercel the address comes from
// x-forwarded-for, which Vercel overwrites (a client can't set it). If the database can't be
// reached, logins are still checked but not counted: an outage never locks Jack out.

import { createHash, timingSafeEqual } from "node:crypto";
import { db, dbConfigured } from "./db";

/** Wrong passwords from one address before it's refused, and the window they count in. */
export const MAX_FAILURES = 10;
export const WINDOW_MINUTES = 15;

/** Does `given` equal the app password? Constant time (both are hashed to the same length). */
export function passwordMatches(given: unknown, expected: string | undefined): boolean {
  if (!expected || typeof given !== "string") return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** The client's address as the platform reports it. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/** Seconds until this address may try again, or null when it may try now. */
export async function lockedFor(ip: string): Promise<number | null> {
  if (!dbConfigured()) return null;
  try {
    const [r] = await db()<{ n: number; wait: number | null }[]>`
      select count(*)::int as n,
        extract(epoch from min(at) + ${`${WINDOW_MINUTES} minutes`}::interval - now())::int as wait
      from login_attempts
      where ip = ${ip} and at > now() - ${`${WINDOW_MINUTES} minutes`}::interval
    `;
    return r && r.n >= MAX_FAILURES ? Math.max(r.wait ?? 0, 1) : null;
  } catch (e) {
    console.error(`[login-guard] lockout check failed: ${(e as Error).message}`);
    return null;
  }
}

/** Count a wrong password (and drop rows too old to matter). */
export async function recordFailure(ip: string): Promise<void> {
  if (!dbConfigured()) return;
  try {
    await db()`insert into login_attempts (ip) values (${ip})`;
    await db()`delete from login_attempts where at < now() - interval '1 day'`;
  } catch (e) {
    console.error(`[login-guard] couldn't record a failure: ${(e as Error).message}`);
  }
}

/** A right password clears the address's count. */
export async function clearFailures(ip: string): Promise<void> {
  if (!dbConfigured()) return;
  await db()`delete from login_attempts where ip = ${ip}`.catch(() => {});
}
