"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "loading" | "unsupported" | "install-first" | "off" | "on" | "blocked";

export function PushSettings() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_PUBLIC_KEY) {
        // iOS Safari only exposes push to apps added to the home screen.
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
        setState(ios ? "install-first" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.register("/sw.js");
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
      setState("on");
      toast.success("Notifications on for this device");
    } catch (e) {
      toast.error(`Couldn't enable notifications: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    const res = await fetch("/api/push/test", { method: "POST" });
    const out = await res.json().catch(() => ({}));
    if (res.ok) toast.success(`Test sent to ${out.sent} device${out.sent === 1 ? "" : "s"}`);
    else toast.error(`Test failed: ${out.error ?? res.status}`);
    setBusy(false);
  }

  if (state === "loading") return <p className="text-sm text-muted-foreground">Checking…</p>;
  if (state === "install-first")
    return (
      <p className="text-sm">
        On iPhone, notifications need the app on your home screen: Share → Add to Home Screen, then
        open it from there and come back here.
      </p>
    );
  if (state === "unsupported")
    return (
      <p className="text-sm text-muted-foreground">
        This browser can&apos;t receive push notifications.
      </p>
    );
  if (state === "blocked")
    return (
      <p className="text-sm text-destructive">
        Notifications are blocked for this site. Allow them in the browser or iOS Settings, then
        reload.
      </p>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === "off" ? (
        <Button size="sm" onClick={enable} disabled={busy}>
          Enable notifications on this device
        </Button>
      ) : (
        <span className="text-sm">Notifications are on for this device.</span>
      )}
      <Button size="sm" variant="outline" onClick={test} disabled={busy || state !== "on"}>
        Send test
      </Button>
    </div>
  );
}
