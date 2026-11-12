"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-render the page from fresh data once, a minute after `at` (today's first tip: from then on
 * a move counts from tomorrow). A phone that slept through it refreshes when it's shown again.
 */
export function RefreshAt({ at }: { at: number | null }) {
  const router = useRouter();
  useEffect(() => {
    if (at == null) return;
    const due = at + 60_000;
    if (Date.now() >= due) return;
    let done = false;
    const refresh = () => {
      if (done || Date.now() < due || document.visibilityState !== "visible") return;
      done = true;
      router.refresh();
    };
    const id = setTimeout(refresh, due - Date.now());
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [at, router]);
  return null;
}
