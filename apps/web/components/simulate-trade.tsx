"use client";

// Simulate a trade's season odds on the worker (app/api/trades/simulate): thousands of seasons
// with and without it, to the top tier's precision. It takes a few minutes (a runner starts,
// then the job), so the button checks every 20 seconds (a one-row read) and reloads the page
// once the result is in. Read-only: nothing is sent to ESPN.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SimulateTrade({
  partnerId,
  give,
  get,
  pending = false,
  compact = false,
}: {
  partnerId: number;
  give: number[];
  get: number[];
  /** Already asked, and its result is still coming. */
  pending?: boolean;
  /** A small button (in a list of ideas). */
  compact?: boolean;
}) {
  const router = useRouter();
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(pending);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy || !key) return;
    const id = setInterval(async () => {
      const r = await fetch(`/api/trades/simulate?key=${encodeURIComponent(key)}`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      if (r && !r.pending) {
        clearInterval(id);
        setBusy(false);
        router.refresh();
      }
    }, 20_000);
    return () => clearInterval(id);
  }, [busy, key, router]);

  async function run() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/trades/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId, give, get }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? res.status);
      setKey(out.key);
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
    }
  }

  if (busy)
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        Simulating the season with and without it (a few minutes; this page updates when it&apos;s
        done).
      </p>
    );
  return (
    <div className="space-y-1">
      <Button
        onClick={run}
        size={compact ? "sm" : "default"}
        variant={compact ? "outline" : "default"}
      >
        Simulate season odds
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
