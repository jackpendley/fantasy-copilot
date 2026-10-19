import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Save (or refresh) this device's push subscription. */
export async function POST(request: NextRequest) {
  const sub = await request.json().catch(() => null);
  const endpoint: unknown = sub?.endpoint;
  const keys = sub?.keys;
  if (
    typeof endpoint !== "string" ||
    !endpoint.startsWith("https://") ||
    !keys?.p256dh ||
    !keys?.auth
  ) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }
  await db()`
    insert into push_subscriptions (endpoint, keys)
    values (${endpoint}, ${db().json({ p256dh: keys.p256dh, auth: keys.auth })})
    on conflict (endpoint) do update set keys = excluded.keys
  `;
  return NextResponse.json({ ok: true });
}
