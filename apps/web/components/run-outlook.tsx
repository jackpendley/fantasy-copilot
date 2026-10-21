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
    if (res.ok && out.outcome === "busy") toast.info("Already updating. It'll refresh shortly.");
    else if (res.ok) toast.success("Outlook updated");
    else toast.error(`Outlook failed: ${out.error ?? res.status}`);
    setBusy(false);
    router.refresh();
  }
  return (
    <Button size="sm" variant="outline" onClick={run} disabled={busy}>
      {busy ? "Simulating…" : "Recalculate"}
    </Button>
  );
}
