import { describe, expect, it, vi } from "vitest";
import { fetchSeasonPool } from "../src/index";

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
