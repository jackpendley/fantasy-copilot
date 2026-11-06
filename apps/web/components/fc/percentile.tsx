// League percentiles on the app's 7-level scale (lib/percentile.ts, ADR-061). The level is
// always written too ("94th"), never shown by color alone.

import { PCT_FILL, PCT_INK, ordinal, pctLevel } from "@/lib/percentile";
import { cn } from "@/lib/utils";

/** "94th" on its level's fill. `colored` false: a style stat, neither good nor bad (neutral). */
export function PercentileBadge({
  p,
  colored = true,
  title = "League percentile among regulars",
}: {
  p: number | null;
  colored?: boolean;
  title?: string;
}) {
  const level = pctLevel(p, colored ? "high" : null);
  if (p == null || level == null) return null;
  return (
    <span
      className={cn(
        "rounded px-1 text-[10px] font-semibold text-foreground tabular-nums",
        PCT_FILL[level],
      )}
      title={title}
    >
      {ordinal(p)}
    </span>
  );
}

/** A value in its percentile's ink (dense tables), with the percentile in the tooltip. */
export function PercentileText({
  p,
  children,
  className,
}: {
  p: number | null | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  const level = pctLevel(p);
  return (
    <span
      className={cn(level != null && PCT_INK[level], className)}
      title={p != null ? `${ordinal(p)} percentile` : undefined}
    >
      {children}
    </span>
  );
}

/**
 * A stat in a grid (the card's Advanced tab, Compare): the box is shaded by his league
 * percentile, with the percentile written beside the label.
 */
export function StatTile({
  label,
  value,
  p,
  rated = true,
}: {
  label: string;
  value: string;
  p: number | null;
  /** False for a style stat (3-point rate...): neutral, the percentile only informs. */
  rated?: boolean;
}) {
  const level = pctLevel(p, rated ? "high" : null);
  return (
    <div className={cn("rounded-md px-2 py-1.5", level == null ? "border" : PCT_FILL[level])}>
      <div className="flex items-center justify-between gap-1 text-[10.5px] text-foreground/75">
        <span className="truncate">{label}</span>
        {p != null && <span className="shrink-0 tabular-nums">{ordinal(p)}</span>}
      </div>
      <div className="text-sm font-semibold text-foreground tabular-nums">{value}</div>
    </div>
  );
}
