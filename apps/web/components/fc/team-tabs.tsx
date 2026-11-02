"use client";

// Two views of one section, one per team (the matchup's schedules). Both are rendered with
// the page, so switching is instant.

import { useState } from "react";
import { cn } from "@/lib/utils";

export function TeamTabs({ tabs }: { tabs: { label: string; content: React.ReactNode }[] }) {
  const [selected, setSelected] = useState(0);
  return (
    <div className="space-y-1.5">
      <div className="inline-flex max-w-full rounded-lg border bg-card p-0.5" role="tablist">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            type="button"
            role="tab"
            aria-selected={i === selected}
            onClick={() => setSelected(i)}
            className={cn(
              "min-w-0 rounded-md px-3 py-1 text-xs font-medium break-words transition-colors",
              i === selected
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={t.label} hidden={i !== selected}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
