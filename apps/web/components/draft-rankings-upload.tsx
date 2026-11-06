"use client";

// Settings → Draft rankings: pick apps/draft-nba/dist/rankings.csv and it's matched to ESPN
// players and stored privately (POST /api/draft-rankings) for Players → Draft.

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function DraftRankingsUpload({ importedAt }: { importedAt: string | null }) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "done"; matched: number; rows: number; unmatched: string[] }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function upload(file: File) {
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/draft-rankings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: await file.text() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? res.statusText);
      setState({ kind: "done", ...body });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }

  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground">
        {importedAt ? `Last imported ${importedAt}.` : "Nothing imported yet."}
      </p>
      <label className="inline-block">
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          disabled={state.kind === "busy"}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
        <Button asChild variant="outline" size="sm" disabled={state.kind === "busy"}>
          <span>{state.kind === "busy" ? "Importing…" : "Choose rankings.csv"}</span>
        </Button>
      </label>
      {state.kind === "done" && (
        <p className="text-xs text-muted-foreground">
          Matched {state.matched} of {state.rows} players to ESPN.
          {state.unmatched.length > 0 &&
            ` Not found: ${state.unmatched.slice(0, 12).join(", ")}${state.unmatched.length > 12 ? ", …" : ""}.`}
        </p>
      )}
      {state.kind === "error" && <p className="text-xs text-danger">{state.message}</p>}
    </div>
  );
}
