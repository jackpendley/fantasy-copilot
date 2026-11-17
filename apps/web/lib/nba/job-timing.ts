// How long each kind of trigger waits for its numbers (Settings): from when the rosters were
// read for a job to when a runner took its work, its Outlook was fresh, and it finished.

export type TriggerKind =
  "Nightly or Run outlook" | "Your moves" | "Injury news" | "Tip-off" | "League moves";

/** The kind of trigger from a job's label (lib/nba/outlook-refresh.ts and the API routes). */
export function triggerKind(label: string | null): TriggerKind {
  if (label == null) return "Nightly or Run outlook";
  if (label.startsWith("Today's first game tipped")) return "Tip-off";
  if (label.startsWith("Injury news")) return "Injury news";
  if (label.startsWith("You") || label === "Your roster changed") return "Your moves";
  return "League moves";
}

export interface JobTimes {
  trigger: string | null;
  read_at: Date;
  started_at: Date | null;
  outlook_at: Date | null;
  done_at: Date | null;
}

export interface TriggerWait {
  kind: TriggerKind;
  jobs: number;
  /** Median minutes from the rosters' read (null when no job reached that point). */
  started: number | null;
  outlook: number | null;
  done: number | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function triggerWaits(rows: JobTimes[]): TriggerWait[] {
  const by = new Map<TriggerKind, JobTimes[]>();
  for (const r of rows) {
    const k = triggerKind(r.trigger);
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  const mins = (list: JobTimes[], at: (r: JobTimes) => Date | null) =>
    median(
      list.flatMap((r) => {
        const t = at(r);
        return t ? [(t.getTime() - r.read_at.getTime()) / 60_000] : [];
      }),
    );
  return [...by].map(([kind, list]) => ({
    kind,
    jobs: list.length,
    started: mins(list, (r) => r.started_at),
    outlook: mins(list, (r) => r.outlook_at),
    done: mins(list, (r) => r.done_at),
  }));
}
