// The Players section's header: title, search (any player, as you type) and its three views.
// Each view is its own route, so only the open one loads its data.

import Link from "next/link";
import { PageHeader } from "@/components/fc/bits";
import { PlayerSearch } from "@/components/fc/player-search";
import { cn } from "@/lib/utils";

const VIEWS = [
  { key: "moves", label: "Moves", href: "/nba/players" },
  { key: "free-agents", label: "Free agents", href: "/nba/players/free-agents" },
  { key: "trends", label: "Trends", href: "/nba/players/trends" },
] as const;

export function PlayersNav({
  view,
  subtitle,
  query,
}: {
  view: (typeof VIEWS)[number]["key"];
  subtitle?: React.ReactNode;
  query?: string;
}) {
  return (
    <>
      <PageHeader title="Players" subtitle={subtitle} />
      <PlayerSearch initial={query} />
      <nav className="grid grid-cols-3 gap-1 rounded-lg border bg-card p-1" aria-label="Players">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.href}
            aria-current={v.key === view ? "page" : undefined}
            className={cn(
              "rounded-md py-1.5 text-center text-sm font-medium transition-colors",
              v.key === view
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
