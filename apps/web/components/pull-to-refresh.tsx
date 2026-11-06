"use client";

// Pull down at the top of a page to refresh it (phones and the installed app, which has no
// browser pull-to-refresh of its own). The spinner follows the finger with some resistance and
// turns with the pull; past the threshold, letting go re-renders the page from fresh data
// (router.refresh) and the spinner keeps spinning until it's done. The browser's own pull and
// bounce are off (globals.css, overscroll-behavior), so the two never fight.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/** How far to pull (after resistance) before letting go refreshes, and the most it travels. */
const THRESHOLD = 64;
const MAX = 96;
const RESISTANCE = 0.5;

/** Drags starting here belong to something else (the player card, sideways scrollers). */
const ignore = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest('[role="dialog"], [data-no-pull], input, textarea, select'));

export function PullToRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pull, setPull] = useState(0);
  // The finger is down and pulling: the spinner follows it without easing.
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pulling = useRef(false);
  const pullRef = useRef(0);

  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const set = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };
    const onStart = (e: TouchEvent) => {
      if (window.scrollY > 0 || e.touches.length !== 1 || ignore(e.target)) {
        start.current = null;
        return;
      }
      start.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
      pulling.current = false;
    };
    const onMove = (e: TouchEvent) => {
      if (!start.current) return;
      const dx = e.touches[0]!.clientX - start.current.x;
      const dy = e.touches[0]!.clientY - start.current.y;
      if (!pulling.current) {
        // Decide once: a downward drag at the top of the page pulls; anything else scrolls.
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) {
          start.current = null;
          return;
        }
        pulling.current = true;
        setDragging(true);
      }
      e.preventDefault();
      set(Math.min(MAX, Math.max(0, dy * RESISTANCE)));
    };
    const onEnd = () => {
      if (!pulling.current) return;
      pulling.current = false;
      setDragging(false);
      start.current = null;
      // Past the threshold: refresh (the spinner holds and spins while it runs).
      if (pullRef.current >= THRESHOLD) startTransition(() => router.refresh());
      set(0);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [router]);

  // While refreshing it holds at the threshold and spins; otherwise it follows the finger, and
  // eases away when it's let go (or the refresh is done).
  const refreshing = pending;
  const offset = dragging ? pull : refreshing ? THRESHOLD : 0;
  const progress = Math.min(1, offset / THRESHOLD);
  return (
    <div
      aria-hidden={!refreshing}
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.5rem)] z-40 flex justify-center"
      style={{
        transform: `translateY(${offset - 44}px)`,
        opacity: refreshing ? 1 : progress,
        transition: dragging ? "none" : "transform 250ms ease, opacity 250ms ease",
      }}
    >
      <div className="flex size-9 items-center justify-center rounded-full border bg-card shadow-md">
        <RefreshCw
          className={cn(
            "size-4 text-primary",
            refreshing && "animate-spin motion-reduce:animate-none",
          )}
          style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
        />
        {refreshing && <span className="sr-only">Refreshing</span>}
      </div>
    </div>
  );
}
