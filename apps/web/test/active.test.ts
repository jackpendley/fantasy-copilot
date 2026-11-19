import { describe, expect, it } from "vitest";
import { activeStatus } from "@/lib/nba/active";

describe("who is active tonight", () => {
  const espn = { espn: "ACTIVE", espnNote: null, nbaInactive: false, official: null };

  it("takes NBA.com's inactive list over everything else (a late scratch)", () => {
    expect(activeStatus({ ...espn, nbaInactive: true, espnNote: "Rest" })).toEqual({
      status: "OUT",
      source: "NBA.com",
      note: "Inactive (NBA.com) · Rest",
    });
  });

  it("takes the official report's Out over an ESPN status that lags it", () => {
    expect(
      activeStatus({ ...espn, espn: "DAY_TO_DAY", espnNote: "Ankle", official: "Out" }),
    ).toEqual({ status: "OUT", source: "official report", note: "Out (official report) · Ankle" });
  });

  it("leaves ESPN's status otherwise (the report's finer statuses aren't used yet)", () => {
    expect(activeStatus({ ...espn, espn: "QUESTIONABLE", official: "Probable" })).toEqual({
      status: "QUESTIONABLE",
      source: "ESPN",
      note: null,
    });
    expect(activeStatus({ ...espn, espn: "OUT", espnNote: "Knee", official: "Out" }).source).toBe(
      "ESPN",
    );
  });
});
