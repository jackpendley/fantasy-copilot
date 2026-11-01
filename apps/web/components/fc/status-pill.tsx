import { normalizeStatus } from "@fantasy-copilot/fantasy-core";
import { cn } from "@/lib/utils";

const STYLE: Record<string, { label: string; short: string; tone: string }> = {
  OUT: { label: "Out", short: "O", tone: "danger" },
  INJURY_RESERVE: { label: "IR", short: "IR", tone: "danger" },
  SUSPENSION: { label: "Susp", short: "Susp", tone: "danger" },
  DOUBTFUL: { label: "Doubtful", short: "D", tone: "danger" },
  QUESTIONABLE: { label: "Q", short: "Q", tone: "warning" },
  DAY_TO_DAY: { label: "DTD", short: "DTD", tone: "warning" },
  PROBABLE: { label: "Prob", short: "P", tone: "info" },
};

const TONE: Record<string, string> = {
  danger: "bg-danger/15 text-danger",
  warning: "bg-warning/15 text-warning",
  info: "bg-info/15 text-info",
  success: "bg-success/15 text-success",
  muted: "bg-muted text-muted-foreground",
  primary: "bg-primary/15 text-primary",
};

export function Pill({
  tone = "muted",
  children,
  title,
  className,
}: {
  tone?: keyof typeof TONE;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] leading-none font-semibold",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Injury status pill; renders nothing for healthy players. `short`: ESPN's one-letter forms. */
export function StatusPill({
  status,
  note,
  short = false,
  className,
}: {
  status: string;
  note?: string | null;
  short?: boolean;
  className?: string;
}) {
  const s = normalizeStatus(status);
  const style = STYLE[s];
  if (s === "ACTIVE" || !style) return null;
  return (
    <Pill tone={style.tone as keyof typeof TONE} title={note ?? undefined} className={className}>
      {short ? style.short : style.label}
    </Pill>
  );
}
