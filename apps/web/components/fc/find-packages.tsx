"use client";

// "Find trade packages" for a watched player on another team: asks the worker for the best
// packages that get him (about a minute while a runner starts), checks every 15 seconds whether
// it's done (a one-row read), then reloads the page once to show them. Nothing goes to ESPN.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FindPackages({
  playerId,
  searching,
  again,
}: {
  playerId: number;
  /** A search for him is already under way. */
  searching: boolean;
  /** He has packages already: the button searches again. */
  again: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(searching);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(async () => {
      const r = await fetch(`/api/trades/packages?id=${playerId}`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
      if (r && !r.searching) {
        clearInterval(id);
        setBusy(false);
        router.refresh();
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [busy, playerId, router]);

  async function ask() {
    setError(null);
    setBusy(true);
    const res = await fetch("/api/trades/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
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
        Searching packages (usually a minute or two). Their simulations follow.
      </p>
    );
  return (
    <div className="space-y-1">
      <Button size="sm" variant="outline" onClick={ask}>
        {again ? "Search again" : "Find trade packages"}
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
