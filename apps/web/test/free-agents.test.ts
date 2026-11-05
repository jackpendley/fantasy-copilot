import { describe, expect, it } from "vitest";
import { playsPosition, sortRows, type FreeAgentRow } from "@/lib/free-agents";

const row = (id: number, over: Partial<FreeAgentRow>): FreeAgentRow => ({
  id,
  name: `P${id}`,
  status: "ACTIVE",
  proTeam: "ATL",
  positions: ["PG"],
  waivers: false,
  fppg: 20,
  fppgPct: null,
  last7: null,
  weekGames: 3,
  owned: 10,
  change: 0,
  season: 1000,
  title: null,
  ...over,
});

describe("free agent filters and sorting", () => {
  it("G is any guard, F any forward", () => {
    expect(playsPosition(["PG"], "G")).toBe(true);
    expect(playsPosition(["SG", "SF"], "G")).toBe(true);
    expect(playsPosition(["C"], "G")).toBe(false);
    expect(playsPosition(["PF", "C"], "F")).toBe(true);
    expect(playsPosition(["C"], "F")).toBe(false);
    expect(playsPosition(["C"], "C")).toBe(true);
    expect(playsPosition(["C"], "All")).toBe(true);
  });

  it("sorts high to low, missing values last, and flips", () => {
    const rows = [row(1, { last7: 10 }), row(2, { last7: null }), row(3, { last7: 30 })];
    expect(sortRows(rows, "last7").map((r) => r.id)).toEqual([3, 1, 2]);
    expect(sortRows(rows, "last7", true).map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it("sorts names A to Z, and ties by FP/G", () => {
    const rows = [row(1, { name: "Zed" }), row(2, { name: "Abe" })];
    expect(sortRows(rows, "name").map((r) => r.id)).toEqual([2, 1]);
    const tied = [row(1, { owned: 5, fppg: 10 }), row(2, { owned: 5, fppg: 25 })];
    expect(sortRows(tied, "owned").map((r) => r.id)).toEqual([2, 1]);
  });

  it("sorts by the deep check's title change, unchecked players last", () => {
    const t = (d: number) => ({ d, se: 0.002, drop: null, updating: false });
    const rows = [row(1, {}), row(2, { title: t(-0.01) }), row(3, { title: t(0.004) })];
    expect(sortRows(rows, "title").map((r) => r.id)).toEqual([3, 2, 1]);
  });
});
