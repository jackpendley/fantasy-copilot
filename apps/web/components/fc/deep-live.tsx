"use client";

// The Moves page's deep checks, kept current while the worker re-checks moves (ADR-058): the
// page renders the numbers as they are, and this polls /api/moves/status every 20 seconds
// while a job runs (visible tabs only), so cards swap in new numbers without a reload. A tab
// shown again (a phone app reopened) asks once, and after a long time away reloads the page.

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { DeepView } from "@/lib/nba/move-shown";

const Ctx = createContext<DeepView | null>(null);

/** The page's deep checks (null when the page has none, e.g. without the worker). */
export const useDeepView = () => useContext(Ctx);

/** The checks refresh at most every 20 s (lib/nba/sim-jobs.ts REFRESH_GAP_S). */
const POLL_MS = 20_000;
/** How long a check the page queued is waited for (its job is built first, ~1-2 minutes). */
const WAIT_MS = 10 * 60_000;
/** Hidden this long, a tab reloads the page when shown again (the day or the moves may differ). */
const STALE_MS = 5 * 60_000;

/** While a queued check is awaited, moves without numbers show as being checked. */
const awaiting = (v: DeepView): DeepView => ({
  ...v,
  states: Object.fromEntries(
    Object.entries(v.states).map(([k, s]) => [k, s === "none" ? "loading" : s]),
  ),
});

export function DeepLive({
  initial,
  roster,
  keys,
  queued = false,
  children,
}: {
  initial: DeepView;
  /** Jack's roster key the page was rendered for. */
  roster: string;
  /** Every move on the page. */
  keys: string[];
  /** The page queued a check (its moves had no numbers and no job was running). */
  queued?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [waiting, setWaiting] = useState(queued);
  const [view, setView] = useState(queued ? awaiting(initial) : initial);
  // A new render from the server (a refresh) brings new numbers.
  const [rendered, setRendered] = useState(initial);
  if (rendered !== initial) {
    setRendered(initial);
    setWaiting(queued);
    setView(queued ? awaiting(initial) : initial);
  }
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setWaiting(false), WAIT_MS);
    return () => clearTimeout(t);
  }, [waiting]);
  const live = view.job?.live ?? false;
  useEffect(() => {
    const poll = async () => {
      const res = await fetch("/api/moves/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster, keys, version: view.version }),
      }).catch(() => null);
      // 204: nothing new since the numbers on the page.
      if (!res?.ok || res.status === 204) return;
      const next = (await res.json()) as DeepView;
      // The queued job is under way: from here its own state shows.
      if (next.job?.live) setWaiting(false);
      setView(waiting && !next.job?.live ? awaiting(next) : next);
    };
    let hiddenAt = document.visibilityState === "hidden" ? Date.now() : null;
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt != null ? Date.now() - hiddenAt : 0;
      hiddenAt = null;
      if (away >= STALE_MS) router.refresh();
      else void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id =
      live || waiting
        ? setInterval(() => {
            if (document.visibilityState === "visible") void poll();
          }, POLL_MS)
        : undefined;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (id) clearInterval(id);
    };
  }, [live, waiting, roster, keys, router, view.version]);
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
