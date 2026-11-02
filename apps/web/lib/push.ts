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

interface Subscription {
  id: number;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface Delivery {
  sent: number[];
  /** Subscriptions the push service says are gone (404/410): delete them. */
  gone: number[];
  /** Other failures, e.g. 403 for a subscription made with an earlier key. */
  failed: { id: number; error: string }[];
}

/** Send to each subscription; one device's failure never stops the others. */
export async function deliver(
  subs: Subscription[],
  send: (s: Subscription) => Promise<unknown>,
): Promise<Delivery> {
  const out: Delivery = { sent: [], gone: [], failed: [] };
  for (const s of subs) {
    try {
      await send(s);
      out.sent.push(s.id);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) out.gone.push(s.id);
      else out.failed.push({ id: s.id, error: status ? `${status}` : (e as Error).message });
    }
  }
  return out;
}

/** Send to all devices; drop subscriptions the push service says are gone. */
export async function sendToAll(
  msg: PushMessage,
): Promise<{ sent: number; removed: number; failed: number; errors: string[] }> {
  if (!pushConfigured()) throw new Error("VAPID keys not configured");
  configure();
  const subs = await db()<Subscription[]>`select id, endpoint, keys from push_subscriptions`;
  const d = await deliver(subs, (s) =>
    webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(msg)),
  );
  if (d.sent.length) {
    await db()`update push_subscriptions set last_ok_at = now() where id in ${db()(d.sent)}`;
  }
  if (d.gone.length) await db()`delete from push_subscriptions where id in ${db()(d.gone)}`;
  return {
    sent: d.sent.length,
    removed: d.gone.length,
    failed: d.failed.length,
    errors: d.failed.map((f) => f.error),
  };
}

/**
 * Send an alert unless its key was already sent. Returns whether it went out now. Without
 * push keys it does nothing; if every device failed, the key is released so the next check
 * tries again.
 */
export async function sendAlertOnce(key: string, msg: PushMessage): Promise<boolean> {
  if (!pushConfigured()) return false;
  const inserted = await db()`
    insert into alerts_sent (dedupe_key, title, body)
    values (${key}, ${msg.title}, ${msg.body})
    on conflict (dedupe_key) do nothing
    returning id
  `;
  if (!inserted.length) return false;
  const release = () => db()`delete from alerts_sent where dedupe_key = ${key}`;
  try {
    const r = await sendToAll(msg);
    if (!r.sent && r.failed) {
      throw new Error(`push failed on every device (${r.errors.join(", ")})`);
    }
    return r.sent > 0;
  } catch (e) {
    await release().catch(() => {});
    throw e;
  }
}
