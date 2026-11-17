import { describe, expect, it } from "vitest";
import { onPace, periodEnd, planReview, usageAlerts, type NeonUsage } from "@/lib/neon-budget";

const start = new Date("2026-11-01T00:00:00Z");
const usage = (transferBytes: number, cuHours: number, from = start): NeonUsage => ({
  transferBytes,
  cuHours,
  activeHours: cuHours * 4,
  periodStart: from,
  periodEnd: null,
});

describe("Neon usage budget", () => {
  it("ends a period on the next 1st when Neon doesn't say", () => {
    // Nov 16's upgrade restarted the period mid-month.
    const u = usage(0, 0, new Date("2026-11-16T20:55:00Z"));
    expect(periodEnd(u)).toEqual(new Date("2026-12-01T00:00:00Z"));
    expect(periodEnd({ ...u, periodEnd: new Date("2026-12-02T00:00:00Z") })).toEqual(
      new Date("2026-12-02T00:00:00Z"),
    );
  });

  it("scales to a whole month, only after the first day", () => {
    expect(onPace(usage(1e9, 10), new Date("2026-11-01T12:00:00Z"))).toBeNull();
    const pace = onPace(usage(1e9, 30), new Date("2026-11-16T00:00:00Z"))!;
    expect(pace.transferBytes).toBeCloseTo(2.03e9, -7);
    expect(pace.cuHours).toBeCloseTo(60.9, 0);
  });

  it("alerts at the highest Free threshold passed, once per period", () => {
    // Nov 16's real numbers: 5.03 GB and 52 CU-hours.
    const keys = usageAlerts(usage(5.03e9, 51.97), new Date("2026-11-16T22:00:00Z")).map(
      (a) => a.key,
    );
    expect(keys).toContain("neon:2026-11:transfer:0.85");
    expect(keys).not.toContain("neon:2026-11:transfer:0.6");
    expect(keys).not.toContain("neon:2026-11:compute:0.6");
    expect(keys).toEqual(
      expect.arrayContaining(["neon:2026-11:transfer:pace", "neon:2026-11:compute:pace"]),
    );
  });

  it("stays quiet under budget before the period's last day", () => {
    expect(usageAlerts(usage(0.5e9, 15), new Date("2026-11-16T00:00:00Z"))).toEqual([]);
  });

  it("says in the period's last day and a half whether Free would fit", () => {
    const from = new Date("2026-11-16T20:55:00Z");
    // Nov 30's nightly (6 AM ET) and pregame (5 PM ET) runs; none after the period ends.
    const nightly = new Date("2026-11-30T11:00:00Z");
    expect(planReview(usage(0.6e9, 14, from), new Date("2026-11-29T11:00:00Z"))).toBeNull();
    const fits = planReview(usage(0.6e9, 14, from), nightly)!;
    expect(fits.key).toBe("neon:2026-11:review");
    expect(fits.title).toBe("Database fits Neon Free");
    expect(fits.body).toContain("Nov 16–Nov 30");
    expect(planReview(usage(3e9, 14, from), nightly)!.title).toBe(
      "Database still needs Neon Launch",
    );
    expect(planReview(usage(0.6e9, 14, from), new Date("2026-12-01T01:00:00Z"))).toBeNull();
    expect(usageAlerts(usage(0.6e9, 14, from), nightly).map((a) => a.key)).toEqual([
      "neon:2026-11:review",
    ]);
  });
});
