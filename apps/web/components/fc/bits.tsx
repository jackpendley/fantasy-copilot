import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Info, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/** Lineup slot label. `to` shows a recommended move (from → to). */
export function SlotChip({ slot, to }: { slot: string; to?: string }) {
  const base =
    "inline-flex h-6 min-w-11 items-center justify-center rounded-md px-1.5 font-mono text-[11px] font-semibold";
  if (to && to !== slot) {
    return (
      <span className="inline-flex flex-col items-center gap-0.5">
        <span className={cn(base, "h-4 bg-transparent text-muted-foreground line-through")}>
          {slot}
        </span>
        <span className={cn(base, "bg-primary text-primary-foreground")}>{to}</span>
      </span>
    );
  }
  const bench = slot === "BE" || slot === "IR";
  return (
    <span
      className={cn(
        base,
        bench ? "bg-muted text-muted-foreground" : "bg-secondary text-foreground",
      )}
    >
      {slot}
    </span>
  );
}

/** A headline number with a label, e.g. "Title 20%". */
export function StatTile({
  label,
  value,
  sub,
  delta,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** Change since the previous update, already formatted; sign picks the color. */
  delta?: { text: string; up: boolean } | null;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-card p-4", className)}>
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
        {delta && (
          <span
            className={cn(
              "text-xs font-semibold tabular-nums",
              delta.up ? "text-success" : "text-danger",
            )}
          >
            {delta.text}
          </span>
        )}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** Horizontal probability bar (0..1). */
export function ProbBar({
  value,
  className,
  tone = "primary",
}: {
  value: number;
  className?: string;
  tone?: "primary" | "success" | "info";
}) {
  const color = { primary: "bg-primary", success: "bg-success", info: "bg-info" }[tone];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn("h-full rounded-full", color)}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** Prev / today / next links for date-based pages. */
export function DateNav({ prev, next, today }: { prev: string; next: string; today?: string }) {
  const btn =
    "inline-flex h-8 items-center gap-1 rounded-lg border bg-card px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";
  return (
    <div className="flex items-center gap-1.5">
      <Link href={prev} className={btn} aria-label="Previous day">
        <ChevronLeft className="size-4" />
      </Link>
      {today && (
        <Link href={today} className={btn}>
          Today
        </Link>
      )}
      <Link href={next} className={btn} aria-label="Next day">
        <ChevronRight className="size-4" />
      </Link>
    </div>
  );
}

const CALLOUT = {
  danger: { icon: ShieldAlert, cls: "border-danger/30 bg-danger/10 text-danger" },
  warning: { icon: AlertTriangle, cls: "border-warning/30 bg-warning/10 text-warning" },
  info: { icon: Info, cls: "border-border bg-muted/60 text-muted-foreground" },
};

export function Callout({
  tone,
  children,
}: {
  tone: keyof typeof CALLOUT;
  children: React.ReactNode;
}) {
  const { icon: Icon, cls } = CALLOUT[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm", cls)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 text-foreground">{children}</div>
    </div>
  );
}

export function SectionTitle({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between px-1 pt-2">
      <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {children}
      </h2>
      {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
    </div>
  );
}
