"use client";

// The Players section's tabs (in its layout, so they stay on screen while a view loads).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const VIEWS = [
  { label: "Moves", href: "/nba/players" },
  { label: "Free agents", href: "/nba/players/free-agents" },
  { label: "Trends", href: "/nba/players/trends" },
  { label: "Draft", href: "/nba/players/draft" },
] as const;

export function PlayersTabs() {
  const path = usePathname();
  return (
    <nav className="grid grid-cols-4 gap-1 rounded-lg border bg-card p-1" aria-label="Players">
      {VIEWS.map((v) => {
        const on = path === v.href;
        return (
          <Link
            key={v.href}
            href={v.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "rounded-md py-1.5 text-center text-sm font-medium transition-colors",
              on
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
          </Link>
        );
      })}
    </nav>
  );
}
