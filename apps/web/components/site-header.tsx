"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NBA_NAV, SETTINGS_NAV, SPORTS } from "./nav";
import { ThemeToggle } from "./theme-toggle";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
        FC
      </span>
      <span>Fantasy Copilot</span>
    </Link>
  );
}

/** Top bar. On phones it shows the logo and sport; navigation moves to the bottom tab bar. */
export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
        <Logo />
        <div className="flex items-center gap-1">
          {SPORTS.map((s) =>
            s.live ? (
              <span
                key={s.key}
                className="rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground"
              >
                {s.label}
              </span>
            ) : (
              <span
                key={s.key}
                title={`${s.label} coming soon`}
                className="hidden rounded-md px-2 py-0.5 text-xs font-medium text-muted-foreground/60 sm:inline"
              >
                {s.label}
              </span>
            ),
          )}
        </div>
        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {NBA_NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                path.startsWith(n.href) && "bg-muted text-foreground",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-3 md:flex">
          <ThemeToggle compact />
          <Link
            href={SETTINGS_NAV.href}
            className={cn(
              "rounded-md p-1.5 text-muted-foreground hover:text-foreground",
              path.startsWith(SETTINGS_NAV.href) && "text-foreground",
            )}
            aria-label="Settings"
          >
            <SETTINGS_NAV.icon className="size-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Phone navigation: fixed bottom tab bar, clear of the iPhone home indicator. */
export function BottomNav() {
  const path = usePathname();
  const items = [...NBA_NAV, SETTINGS_NAV];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="grid grid-cols-4">
        {items.map(({ href, label, icon: Icon }) => {
          const active = path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground",
                active && "text-primary",
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
