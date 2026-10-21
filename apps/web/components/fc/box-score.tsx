import { Fragment } from "react";
import { ChevronDown, Triangle } from "lucide-react";
import { statDetail, statSummary, type Trend } from "@/lib/nba/live";
import { cn } from "@/lib/utils";

/**
 * A player's game in one line of scoring stats ("22 PTS 9 REB 1 AST"); tap (or hover) for the
 * rest of the box score: shooting, turnovers, minutes.
 */
export function BoxScore({
  line,
  className,
}: {
  line: Record<string, number> | null;
  className?: string;
}) {
  const summary = statSummary(line);
  const detail = statDetail(line);
  if (!summary) return null;
  return (
    <details className={cn("group min-w-0", className)}>
      <summary
        className="cursor-pointer list-none text-foreground/85 tabular-nums [&::-webkit-details-marker]:hidden"
        title={detail ?? undefined}
      >
        {/* Each "22 PTS" stays together; lines break only between stats. */}
        {summary.match(/\S+ \S+/g)!.map((t, i) => (
          <Fragment key={`${i}-${t}`}>
            {i > 0 && " "}
            <span className="whitespace-nowrap">{t}</span>
          </Fragment>
        ))}
        <ChevronDown
          className="ml-0.5 inline size-3 align-[-2px] text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="mt-0.5 text-muted-foreground tabular-nums">{detail}</div>
    </details>
  );
}

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
