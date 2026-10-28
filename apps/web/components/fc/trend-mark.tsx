import { Triangle } from "lucide-react";
import type { Trend } from "@/lib/nba/live";
import { cn } from "@/lib/utils";

/** Solid ▲ (green) or ▼ (red) when a player is running well above or below his projection. */
export function TrendMark({ trend, className }: { trend: Trend; className?: string }) {
  if (!trend) return null;
  return (
    <Triangle
      className={cn(
        "size-3.5 shrink-0 fill-current stroke-none",
        trend === "up" ? "text-success" : "rotate-180 text-danger",
        className,
      )}
      aria-label={trend === "up" ? "Well above projection" : "Well below projection"}
      role="img"
    />
  );
}
