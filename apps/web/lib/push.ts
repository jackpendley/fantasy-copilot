import "server-only";
// Web push to every subscribed device. Alerts are deduplicated through `alerts_sent`:
// a key is sent once, however often the rule that produced it re-fires.

import webpush from "web-push";
import { db } from "./db";

export interface PushMessage {
  title: string;
  body: string;
  url: string;
}

export const pushConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

function configure() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "https://fantasycopilot.vercel.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

/** Send to all devices; drop subscriptions the push service says are gone. */
export async function sendToAll(msg: PushMessage): Promise<{ sent: number; removed: number }> {
  if (!pushConfigured()) throw new Error("VAPID keys not configured");
  configure();
  const subs = await db()<
    { id: number; endpoint: string; keys: { p256dh: string; auth: string } }[]
  >`
    select id, endpoint, keys from push_subscriptions
  `;
  let sent = 0;
  let removed = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(msg));
      sent++;
      await db()`update push_subscriptions set last_ok_at = now() where id = ${s.id}`;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db()`delete from push_subscriptions where id = ${s.id}`;
        removed++;
      } else {
        throw e;
      }
    }
  }
  return { sent, removed };
}

/** Send an alert unless its key was already sent. Returns whether it went out now. */
export async function sendAlertOnce(key: string, msg: PushMessage): Promise<boolean> {
  const inserted = await db()`
    insert into alerts_sent (dedupe_key, title, body)
    values (${key}, ${msg.title}, ${msg.body})
    on conflict (dedupe_key) do nothing
    returning id
  `;
  if (!inserted.length) return false;
  await sendToAll(msg);
  return true;
}
