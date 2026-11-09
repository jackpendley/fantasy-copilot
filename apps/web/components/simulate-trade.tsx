"use client";

// Simulate a trade's season odds on the worker (app/api/trades/simulate): thousands of seasons
// with and without it, to the top tier's precision. It takes several minutes (a runner starts,
// then the job), so while it runs this checks every 15 seconds (and when the app comes back to
// the front) and shows the numbers so far; once the result is in, it reloads the page once.
// One instance per trade (the page keys it by the trade), so its state never carries over to
// another trade. Read-only: nothing is sent to ESPN.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { DeepTrade } from "@/components/fc/deep-trade";
import { Button } from "@/components/ui/button";
import type { ShownSim, ShownState } from "@/lib/nba/move-shown";

const POLL_MS = 15_000;

interface Status {
  pending: boolean;
  sim: ShownSim | null;
  state: ShownState | null;
  /** A simulation job is running (else the worker is still starting). */
  running: boolean;
}

export function SimulateTrade({
  simKey,
  partnerId,
  give,
  get,
  sim = null,
  state = null,
  pending = false,
}: {
  /** The trade's key (lib/nba/sim-moves.ts tradeKey). */
  simKey: string;
  partnerId: number;
  give: number[];
  get: number[];
  /** Its simulation so far, when it has one. */
  sim?: ShownSim | null;
  state?: ShownState | null;
  /** Already asked, and its result is still coming. */
  pending?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ pending, sim, state, running: false });
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    const r: Status | null = await fetch(`/api/trades/simulate?key=${encodeURIComponent(simKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    if (!r) return;
    setStatus(r);
    if (!r.pending) router.refresh();
  }, [simKey, router]);

  useEffect(() => {
    if (!status.pending) return;
    const id = setInterval(check, POLL_MS);
    // Timers stop while the phone has the app in the background: check as soon as it's back.
    const onShow = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [status.pending, check]);

  async function run() {
    setError(null);
    setStatus((s) => ({ ...s, pending: true }));
    try {
      const res = await fetch("/api/trades/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId, give, get }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? `Couldn't start it (${res.status})`);
    } catch (e) {
      setStatus((s) => ({ ...s, pending: false }));
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-2">
      {status.sim && <DeepTrade sim={status.sim} state={status.state ?? undefined} />}
      {status.pending ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          {status.sim
            ? "Still simulating: the numbers update every 15 seconds and settle in a few minutes."
            : status.running
              ? "Simulating the season with and without it; numbers show here once they're steady (a few minutes)."
              : "Starting the simulation (about a minute)…"}{" "}
          You can leave this page; it keeps running.
        </p>
      ) : (
        !status.sim && (
          <div className="space-y-1">
            <Button onClick={run}>Simulate season odds</Button>
            {error && <p className="text-xs text-danger">{error}</p>}
          </div>
        )
      )}
    </div>
  );
}
