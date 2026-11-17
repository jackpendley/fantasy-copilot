import { describe, expect, it, vi } from "vitest";
import { fetchLeague, fetchProSchedule, fetchSeasonPool } from "../src/index";

// fetch is mocked: these tests never reach ESPN.
describe("fetchSeasonPool", () => {
  it("asks for the whole pool by default (ESPN's sort isn't reliable, so a cap drops players)", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"players":[]}'));
    await fetchSeasonPool(2026, undefined, fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/seasons/2026/segments/0/leaguedefaults/3");
    const filter = JSON.parse((init.headers as Record<string, string>)["X-Fantasy-Filter"]!);
    expect(filter.players.limit).toBeGreaterThanOrEqual(2000);
  });
});

describe("reads", () => {
  it("all carry a timeout, so a request that hangs is given up", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    const f = fetchImpl as unknown as typeof fetch;
    // Synthetic config: no real credentials.
    await fetchLeague({ s2: "S2", swid: "{SWID}", leagueId: 1, season: 2027 }, ["mTeam"], {
      fetchImpl: f,
    });
    await fetchProSchedule(2027, f);
    await fetchSeasonPool(2026, undefined, f);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const call of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[1].signal).toBeInstanceOf(AbortSignal);
    }
  });
});
