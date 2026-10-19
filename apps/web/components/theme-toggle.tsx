"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
] as const;

/** Segmented Dark / Light / System control. `compact` shows icons only. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  // The stored theme is only known in the browser; render a neutral state on the server.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const current = mounted ? theme : undefined;

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
            current === value && "bg-card text-foreground shadow-sm",
          )}
        >
          <Icon className="size-3.5" />
          {!compact && label}
        </button>
      ))}
    </div>
  );
}
