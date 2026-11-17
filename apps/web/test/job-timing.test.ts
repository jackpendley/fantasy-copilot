import { describe, expect, it } from "vitest";
import { triggerKind, triggerWaits } from "@/lib/nba/job-timing";

describe("trigger waits", () => {
  it("sorts labels into kinds", () => {
    expect(triggerKind(null)).toBe("Nightly or Run outlook");
    expect(triggerKind("Today's first game tipped: moves now count from tomorrow")).toBe("Tip-off");
    expect(triggerKind("Injury news for your players")).toBe("Injury news");
    expect(triggerKind("You added Player A, dropped Player B")).toBe("Your moves");
    expect(triggerKind("Your roster changed")).toBe("Your moves");
    expect(triggerKind("Team 4 added Player C")).toBe("League moves");
  });

  it("takes medians in minutes from the rosters' read, skipping jobs that didn't get there", () => {
    const at = (min: number) => new Date(Date.UTC(2026, 10, 17, 20, min));
    const job = (start: number, outlook: number | null, done: number | null) => ({
      trigger: "Injury news for your players",
      read_at: at(0),
      started_at: at(start),
      outlook_at: outlook == null ? null : at(outlook),
      done_at: done == null ? null : at(done),
    });
    expect(triggerWaits([job(1, 3, 10), job(2, 4, null), job(3, null, null)])).toEqual([
      { kind: "Injury news", jobs: 3, started: 2, outlook: 3.5, done: 10 },
    ]);
  });
});
