import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, isValidSession } from "@/lib/auth";

const PWA_FILES = new Set(["/manifest.webmanifest", "/sw.js", "/icon", "/apple-icon"]);

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public: login page/API, the cron route (guarded by CRON_SECRET itself), and the PWA
  // files the OS fetches without the session cookie (manifest, service worker, icons).
  if (
    pathname === "/login" ||
    pathname === "/api/login" ||
    pathname.startsWith("/api/cron") ||
    PWA_FILES.has(pathname)
  ) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(AUTH_COOKIE)?.value;
  if (await isValidSession(cookie)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
