import Link from "next/link";
import { Badge } from "@/components/ui/badge";

// One section per sport. NBA is live; NFL and MLB join the switcher when they ship.
const SPORTS = [{ key: "nba", label: "NBA" }];
const NBA_NAV = [
  { href: "/nba/today", label: "Today" },
  { href: "/nba/week", label: "Week" },
];

export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="font-semibold">
          Fantasy Copilot
        </Link>
        {SPORTS.map((s) => (
          <Badge key={s.key} variant="secondary">
            {s.label}
          </Badge>
        ))}
        <nav className="flex gap-3 text-sm text-muted-foreground">
          {NBA_NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-foreground">
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
