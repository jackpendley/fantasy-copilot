import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, sessionToken } from "@/lib/auth";
import {
  clearFailures,
  clientIp,
  lockedFor,
  passwordMatches,
  recordFailure,
} from "@/lib/login-guard";

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);
  // Checked before the password, so an address that's refused learns nothing from its guesses.
  const wait = await lockedFor(ip);
  if (wait != null) {
    return NextResponse.json(
      { error: "too many attempts", retryAfter: wait },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }
  const { password } = await request.json().catch(() => ({ password: "" }));
  if (!passwordMatches(password, process.env.APP_PASSWORD)) {
    await recordFailure(ip);
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }
  await clearFailures(ip);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, await sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return response;
}
