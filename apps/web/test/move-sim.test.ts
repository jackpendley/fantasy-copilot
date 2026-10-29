import { describe, expect, it } from "vitest";
import { verdictOf } from "@/lib/nba/move-sim";

describe("verdictOf: title odds first, expected wins when the title change is noise", () => {
  it("a clear title change decides", () => {
    expect(verdictOf({ d: 0.03, se: 0.01 }, { d: -0.2, se: 0.05 })).toEqual({
      verdict: "better",
      decidedBy: "title",
    });
    expect(verdictOf({ d: -0.03, se: 0.01 }, { d: 0.2, se: 0.05 })).toEqual({
      verdict: "worse",
      decidedBy: "title",
    });
  });

  it("within the title noise, a clear change in expected wins decides", () => {
    expect(verdictOf({ d: 0.01, se: 0.012 }, { d: 0.15, se: 0.05 })).toEqual({
      verdict: "better",
      decidedBy: "wins",
    });
    expect(verdictOf({ d: 0.01, se: 0.012 }, { d: -0.15, se: 0.05 })).toEqual({
      verdict: "worse",
      decidedBy: "wins",
    });
  });

  it("otherwise it's even (the Demin-for-Gillespie case after the roster fix)", () => {
    expect(verdictOf({ d: -0.016, se: 0.0123 }, { d: 0.056, se: 0.05 })).toEqual({
      verdict: "even",
      decidedBy: "wins",
    });
  });
});
