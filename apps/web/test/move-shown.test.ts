import { describe, expect, it } from "vitest";
import type { DeepEffect } from "@/lib/nba/deep-check";
import { chooseShown, type LiveJob } from "@/lib/nba/move-shown";

const fx = (seasons: number, active: boolean, d = 0.01): DeepEffect => {
  const x = { d, se: 0.002 };
  return {
    key: "k",
    seasons,
    title: x,
    playoffs: x,
    seed1: x,
    bye: x,
    wins: x,
    pBetter: 0.9,
    pBest: null,
    active,
    dropped: false,
  };
};
const job = (rosterKey: string, live: boolean, e?: DeepEffect): LiveJob => ({
  id: 2,
  rosterKey,
  live,
  final: !live,
  effects: e ? new Map([["k", e]]) : null,
});

describe("what a move's card shows", () => {
  it("shows the current check once it has settled", () => {
    const e = fx(12_000, false);
    expect(chooseShown("k", job("R", true, e), null, "R")).toEqual({ state: "current", effect: e });
  });

  it("keeps the last numbers while another team's move or news is re-checked", () => {
    const old = fx(11_000, false, 0.02);
    const s = chooseShown(
      "k",
      job("R", true, fx(1_600, true)),
      { rosterKey: "R", effect: old },
      "R",
    );
    expect(s).toEqual({ state: "updating", effect: old });
  });

  it("after Jack's own move, shows a loader, then the new check once it has enough seasons", () => {
    const old = { rosterKey: "before", effect: fx(11_000, false) };
    expect(chooseShown("k", job("after", true, fx(1_600, true)), old, "after").state).toBe(
      "loading",
    );
    const partial = fx(4_000, true);
    expect(chooseShown("k", job("after", true, partial), old, "after")).toEqual({
      state: "refining",
      effect: partial,
    });
  });

  it("a job's results for another roster don't count, and nothing running means 'none'", () => {
    expect(chooseShown("k", job("other", false, fx(12_000, false)), null, "R").state).toBe("none");
    expect(chooseShown("k", null, { rosterKey: "R", effect: fx(9_000, false) }, "R").state).toBe(
      "current",
    );
  });
});
