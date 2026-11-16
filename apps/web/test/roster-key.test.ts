import { describe, expect, it } from "vitest";
import { rosterKeyOf } from "@/lib/nba/move-checks";
import { samePlayers } from "@/lib/nba/move-shown";

const p = (id: number, slot: string, injuryStatus = "ACTIVE") => ({ id, slot, injuryStatus });
const base = [p(1, "PG"), p(2, "C"), p(3, "BE"), p(4, "UTIL"), p(5, "IR", "OUT")];

describe("Jack's roster key", () => {
  it("ignores lineup changes: the simulation sets its own lineups", () => {
    const swapped = [p(1, "BE"), p(2, "UTIL"), p(3, "C"), p(4, "PG"), p(5, "IR", "OUT")];
    expect(rosterKeyOf(swapped, [])).toBe(rosterKeyOf(base, []));
  });

  it("changes its players part with an add, a drop or an IR move", () => {
    const key = rosterKeyOf(base, []);
    const added = rosterKeyOf([...base.slice(0, 4), p(6, "BE"), p(5, "IR", "OUT")], []);
    const toIR = rosterKeyOf([p(1, "PG"), p(2, "IR"), p(3, "BE"), p(4, "UTIL"), p(5, "BE")], []);
    expect(samePlayers(added, key)).toBe(false);
    expect(samePlayers(toIR, key)).toBe(false);
  });

  it("injury news changes only the news part", () => {
    const news = rosterKeyOf(base, [{ playerId: 2, status: "Out", returnDate: "2026-11-20" }]);
    expect(news).not.toBe(rosterKeyOf(base, []));
    expect(samePlayers(news, rosterKeyOf(base, []))).toBe(true);
  });
});
