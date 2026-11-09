"use client";

// A card that opens to show more when tapped anywhere on it (the Matchup scoreboard). It stays
// open through the page's live refreshes (router.refresh keeps this state).

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function ExpandCard({
  children,
  details,
  label,
}: {
  children: ReactNode;
  details: ReactNode;
  /** What opening it shows, for screen readers ("Matchup details"). */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const toggle = () => setOpen((o) => !o);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  };
  return (
    <div className="rounded-xl border bg-card">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label}: ${open ? "hide" : "show"}`}
        onClick={toggle}
        onKeyDown={onKey}
        className="cursor-pointer rounded-xl p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
      >
        {children}
        <div className="-mb-2 flex justify-center pt-1 text-muted-foreground">
          <ChevronDown
            className={cn(
              "size-4 transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </div>
      </div>
      {open && (
        <div id={id} className="border-t px-4 pt-3 pb-4 sm:px-5">
          {details}
        </div>
      )}
    </div>
  );
}
