"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** While games are live, re-render the page from fresh ESPN data every minute (visible tabs only). */
export function LiveRefresh({ active, seconds = 60 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [active, seconds, router]);
  return null;
}
