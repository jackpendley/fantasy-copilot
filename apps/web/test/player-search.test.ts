import { describe, expect, it } from "vitest";
import { searchPlayers, type SearchPlayer } from "@/lib/player-search";

// Synthetic index (real NBA names are public; owners and numbers are made up).
const p = (id: number, name: string, owned: number): SearchPlayer => ({
  id,
  name,
  team: "ATL",
  positions: ["PG"],
  owner: "Free agent",
  mine: false,
  available: true,
  status: "ACTIVE",
  fppg: 20,
  owned,
});
const index = [
  p(1, "Giannis Antetokounmpo", 100),
  p(2, "Mark Williams", 30),
  p(3, "Lauri Markkanen", 95),
  p(4, "Luka Dončić", 100),
  p(5, "Shai Gilgeous-Alexander", 100),
  p(6, "Marcus Smart", 10),
  p(7, "De'Aaron Fox", 90),
  p(8, "Trey Murphy III", 80),
  p(9, "Gianni Example", 1),
  p(10, "Jalen Williams", 85),
];
const names = (q: string) => searchPlayers(index, q).map((h) => h.player.name);

describe("searchPlayers", () => {
  it("finds a player from the first letters of any part of his name", () => {
    expect(names("Gia")).toEqual(["Giannis Antetokounmpo", "Gianni Example"]);
    expect(names("gia")[0]).toBe("Giannis Antetokounmpo");
  });

  it("ranks any word's start alike (better-known first), then anywhere in the name", () => {
    // Both have a word starting with "mark"; Markkanen is more owned. "Marcus" doesn't match.
    expect(names("mark")).toEqual(["Lauri Markkanen", "Mark Williams"]);
    expect(names("liams")).toEqual(["Jalen Williams", "Mark Williams"]);
  });

  it("ignores accents, case, punctuation and suffixes", () => {
    expect(names("doncic")).toEqual(["Luka Dončić"]);
    expect(names("deaaron")).toEqual(["De'Aaron Fox"]);
    expect(names("gilgeous alex")).toEqual(["Shai Gilgeous-Alexander"]);
    expect(names("murphy")).toEqual(["Trey Murphy III"]);
  });

  it("matches several words in order, initials and one typo", () => {
    expect(names("luka don")).toEqual(["Luka Dončić"]);
    expect(names("sga")).toEqual(["Shai Gilgeous-Alexander"]);
    expect(names("giannus")).toEqual(["Giannis Antetokounmpo"]);
  });

  it("highlights the matched letters in the original name", () => {
    const [hit] = searchPlayers(index, "donc");
    expect(hit!.player.name.slice(...hit!.highlight!)).toBe("Donč");
    const [fox] = searchPlayers(index, "deaa");
    expect(fox!.player.name.slice(...fox!.highlight!)).toBe("De'Aa");
  });

  it("returns nothing for an empty query", () => {
    expect(searchPlayers(index, "  ")).toEqual([]);
  });
});
