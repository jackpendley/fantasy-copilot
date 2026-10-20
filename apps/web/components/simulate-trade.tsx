"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Odds {
  playoffs: number;
  champ: number;
  expWins: number;
}
interface Result {
  seasons: number;
  mine: { before: Odds; after: Odds };
  theirs: { before: Odds; after: Odds };
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function Delta({ before, after }: { before: number; after: number }) {
  const d = (after - before) * 100;
  return (
    <span className="tabular-nums">
      {pct(before)} → <span className="font-semibold">{pct(after)}</span>{" "}
      <span
        className={cn(
          "text-xs",
          Math.abs(d) < 0.05 ? "text-muted-foreground" : d > 0 ? "text-success" : "text-danger",
        )}
      >
        ({d >= 0 ? "+" : ""}
        {d.toFixed(1)})
      </span>
    </span>
  );
}

/** Runs the season simulation with and without the trade (read-only; nothing goes to ESPN). */
export function SimulateTrade({
  partnerId,
  partnerName,
  give,
  get,
}: {
  partnerId: number;
  partnerName: string;
  give: number[];
  get: number[];
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trades/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId, give, get }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? res.status);
      setResult(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button onClick={run} disabled={busy} variant={result ? "outline" : "default"}>
        {busy ? "Simulating seasons…" : result ? "Run again" : "Simulate playoff & title odds"}
      </Button>
      {busy && (
        <p className="text-xs text-muted-foreground">
          Plays out the rest of the season hundreds of times, with and without the trade. Takes up
          to a minute.
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      {result && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium" />
                <th className="px-3 py-2 text-left font-medium">Playoffs</th>
                <th className="px-3 py-2 text-left font-medium">Title</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="px-3 py-2 font-medium">You</td>
                <td className="px-3 py-2">
                  <Delta before={result.mine.before.playoffs} after={result.mine.after.playoffs} />
                </td>
                <td className="px-3 py-2">
                  <Delta before={result.mine.before.champ} after={result.mine.after.champ} />
                </td>
              </tr>
              <tr>
                <td className="max-w-28 truncate px-3 py-2 font-medium">{partnerName}</td>
                <td className="px-3 py-2">
                  <Delta
                    before={result.theirs.before.playoffs}
                    after={result.theirs.after.playoffs}
                  />
                </td>
                <td className="px-3 py-2">
                  <Delta before={result.theirs.before.champ} after={result.theirs.after.champ} />
                </td>
              </tr>
            </tbody>
          </table>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            {result.seasons} simulated seasons each, same random draws. Changes under about 2 points
            are within simulation noise.
          </p>
        </div>
      )}
    </div>
  );
}
