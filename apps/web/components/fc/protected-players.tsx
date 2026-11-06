"use client";

// Jack's protected players (ADR-060), one list per page: "Never drop" on Moves, "Not for trade"
// on Trades. A toggle saves at once (POST /api/prefs, nothing goes to ESPN) and the page
// re-renders; the moves and trade ideas are re-checked in the background.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProtectedPlayer {
  id: number;
  name: string;
  positions: string[];
}

const COPY = {
  noDrop: {
    label: "Never drop",
    help: "Moves never suggest dropping these players.",
  },
  noTrade: {
    label: "Not for trade",
    help: "Trade ideas never offer these players (you can still build a trade with them).",
  },
} as const;

export function ProtectedPlayers({
  field,
  players,
  initial,
}: {
  field: "noDrop" | "noTrade";
  players: ProtectedPlayer[];
  initial: number[];
}) {
  const router = useRouter();
  const [on, setOn] = useState(() => new Set(initial));
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const copy = COPY[field];
  const names = players.filter((p) => on.has(p.id)).map((p) => p.name.split(" ").at(-1));

  async function toggle(id: number) {
    const next = !on.has(id);
    setSaving(id);
    setError(null);
    const set = (v: boolean) =>
      setOn((s) => {
        const n = new Set(s);
        if (v) n.add(id);
        else n.delete(id);
        return n;
      });
    set(next);
    try {
      const res = await fetch("/api/prefs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: id, field, on: next }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
      startTransition(() => router.refresh());
    } catch (e) {
      set(!next);
      setError(`Couldn't save: ${(e as Error).message}`);
    } finally {
      setSaving(null);
    }
  }

  return (
    <details className="group rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium">{copy.label}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {names.length ? names.join(", ") : "nobody"}
        </span>
        <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="space-y-2 border-t px-3 py-2.5">
        <p className="text-xs text-muted-foreground">
          {copy.help}
          {refreshing && " Updating…"}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {players.map((p) => {
            const pressed = on.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={pressed}
                disabled={saving != null}
                onClick={() => toggle(p.id)}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs transition-colors disabled:opacity-60",
                  pressed
                    ? "border-primary bg-primary/10 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
              >
                {pressed && <Lock className="size-3" aria-hidden />}
                {p.name}
                <span className="text-[10px] text-muted-foreground">{p.positions.join("/")}</span>
              </button>
            );
          })}
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </details>
  );
}
