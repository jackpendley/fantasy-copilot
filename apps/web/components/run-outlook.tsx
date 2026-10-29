"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function RunOutlook() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const res = await fetch("/api/outlook/run", { method: "POST" });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.outcome === "busy") toast.info("Already updating.");
    else if (!res.ok) toast.error(`Outlook failed: ${out.error ?? res.status}`);
    // The run starts in the background; give it a moment to post its first odds.
    if (res.ok) await new Promise((r) => setTimeout(r, 2500));
    setBusy(false);
    router.refresh();
  }
  return (
    <Button size="sm" variant="outline" onClick={run} disabled={busy}>
      {busy ? "Starting…" : "Recalculate"}
    </Button>
  );
}
