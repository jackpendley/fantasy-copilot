import { NextResponse } from "next/server";
import { sendToAll } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Send a test notification to every subscribed device. */
export async function POST() {
  try {
    const result = await sendToAll({
      title: "Fantasy Copilot",
      body: "Test notification: alerts reach this device.",
      url: "/settings",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
