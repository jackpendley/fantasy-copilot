import { describe, expect, it } from "vitest";
import { onPace, periodShare, usageAlerts, type NeonUsage } from "@/lib/neon-budget";

const start = new Date("2026-11-01T00:00:00Z");
const usage = (transferBytes: number, cuHours: number): NeonUsage => ({
  transferBytes,
  cuHours,
  activeHours: cuHours * 4,
  periodStart: start,
});

describe("Neon usage budget", () => {
  it("measures the period as one calendar month", () => {
    expect(periodShare(start, new Date("2026-11-16T00:00:00Z"))).toBeCloseTo(0.5);
    expect(periodShare(start, new Date("2026-12-05T00:00:00Z"))).toBe(1);
  });

  it("projects the month only after its first day", () => {
    expect(onPace(usage(1e9, 10), new Date("2026-11-01T12:00:00Z"))).toBeNull();
    const pace = onPace(usage(1e9, 30), new Date("2026-11-16T00:00:00Z"))!;
    expect(pace.transferBytes).toBeCloseTo(2e9);
    expect(pace.cuHours).toBeCloseTo(60);
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

  it("stays quiet under budget", () => {
    expect(usageAlerts(usage(0.5e9, 15), new Date("2026-11-16T00:00:00Z"))).toEqual([]);
  });
});
