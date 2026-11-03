import { describe, expect, it } from "vitest";
import { sortStandings, type StandingsRow } from "@/components/fc/standings-table";

// Synthetic teams (not real data).
const row = (id: number, over: Partial<StandingsRow>): StandingsRow => ({
  id,
  rank: id,
  name: `Team ${id}`,
  mine: false,
  wins: 0,
  losses: 0,
  pf: 0,
  perWeek: 0,
  power: id,
  odds: null,
  ...over,
});
const odds = (bye: number | null, champ: number) => ({
  expWins: 0,
  playoffs: 0,
  seed1: 0,
  bye,
  final: 0,
  champ,
  act: 1,
});

describe("standings sort", () => {
  const rows = [
    row(1, { name: "b", odds: odds(0.2, 0.1) }),
    row(2, { name: "a", odds: odds(0.6, 0.3) }),
    row(3, { name: "c", odds: odds(null, 0.2) }),
  ];

  it("sorts odds biggest first, missing values last, and flips", () => {
    expect(sortStandings(rows, "bye", false).map((r) => r.id)).toEqual([2, 1, 3]);
    expect(sortStandings(rows, "champ", true).map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it("sorts rank 1st first and names A-Z", () => {
    expect(sortStandings(rows, "rank", false).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(sortStandings(rows, "name", false).map((r) => r.id)).toEqual([2, 1, 3]);
  });
});
