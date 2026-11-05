"use client";

// The Moves page's deep checks, kept current while the worker re-checks moves (ADR-058): the
// page renders the numbers as they are, and this polls /api/moves/status every 10 seconds
// while a job runs (visible tabs only), so cards swap in new numbers without a reload.

import { createContext, useContext, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { DeepView } from "@/lib/nba/move-shown";

const Ctx = createContext<DeepView | null>(null);

/** The page's deep checks (null when the page has none, e.g. without the worker). */
export const useDeepView = () => useContext(Ctx);

const POLL_MS = 10_000;

export function DeepLive({
  initial,
  roster,
  keys,
  children,
}: {
  initial: DeepView;
  /** Jack's roster key the page was rendered for. */
  roster: string;
  /** Every move on the page. */
  keys: string[];
  children: React.ReactNode;
}) {
  const [view, setView] = useState(initial);
  const live = view.job?.live ?? false;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetch("/api/moves/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster, keys }),
      }).catch(() => null);
      if (res?.ok) setView((await res.json()) as DeepView);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [live, roster, keys]);
  return <Ctx.Provider value={view}>{children}</Ctx.Provider>;
}

const minutesAgo = (iso: string) =>
  Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));

/** The job's progress above the cards: what it's re-checking and how far along it is. */
export function DeepBanner() {
  const view = useDeepView();
  const job = view?.job;
  if (!job) return null;
  if (!job.live) {
    return (
      <p className="px-1 text-xs text-muted-foreground">
        Every move checked by the deep check ({job.total.toLocaleString("en-US")} moves).
      </p>
    );
  }
  const share = job.total ? job.settled / job.total : 0;
  const what = !job.current
    ? "Checking after your roster change"
    : `Updating${job.trigger ? ` after: ${job.trigger}` : ""}`;
  return (
    <div className="space-y-1 px-1 text-xs text-muted-foreground" aria-live="polite">
      <p className="flex items-center gap-1.5">
        <Loader2 className="size-3 animate-spin" aria-hidden />
        <span suppressHydrationWarning>
          {what} · {job.settled} of {job.total} moves done · started {minutesAgo(job.createdAt)} min
          ago
        </span>
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700"
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </div>
    </div>
  );
}
