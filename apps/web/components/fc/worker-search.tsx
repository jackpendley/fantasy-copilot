"use client";

// A search Jack asks the worker for: a watched player's trade packages, or trades with one team.
// It takes about a minute while a runner starts, so the button checks every 15 seconds whether
// it's done (a one-row read), then reloads the page once to show the results. Nothing goes to
// ESPN.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function WorkerSearch({
  url,
  body,
  statusUrl,
  searching,
  label,
  busyText,
}: {
  /** POST here with `body` to ask. */
  url: string;
  body: object;
  /** GET here: `{ searching }`. */
  statusUrl: string;
  /** A search is already under way. */
  searching: boolean;
  label: string;
  busyText: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(searching);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(async () => {
      const r = await fetch(statusUrl)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      if (r && !r.searching) {
        clearInterval(id);
        setBusy(false);
        router.refresh();
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [busy, statusUrl, router]);

  async function ask() {
    setError(null);
    setBusy(true);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) {
      setBusy(false);
      setError(
        (await res?.json().catch(() => null))?.error ?? "Couldn't start the search. Try again.",
      );
    }
  }

  if (busy)
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        {busyText}
      </p>
    );
  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" onClick={ask}>
        {label}
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
