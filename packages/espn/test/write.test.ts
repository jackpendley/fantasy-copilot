import { describe, expect, it, vi } from "vitest";
import { lineupTransactionBody, submitLineup } from "../src/index";

// Synthetic config: no real credentials. These tests never reach ESPN (fetch is mocked).
const cfg = { s2: "S2", swid: "{SWID}", leagueId: 1, season: 2027 };

describe("lineupTransactionBody", () => {
  it("builds one ROSTER transaction with a LINEUP item per moved player", () => {
    const body = lineupTransactionBody(cfg, 13, 4, [
      { playerId: 10, from: "BE", to: "UTIL" },
      { playerId: 11, from: "UTIL", to: "BE" },
    ]);
    expect(body).toEqual({
      isLeagueManager: false,
      teamId: 13,
      type: "ROSTER",
      memberId: "{SWID}",
      scoringPeriodId: 4,
      executionType: "EXECUTE",
      items: [
        { playerId: 10, type: "LINEUP", fromLineupSlotId: 12, toLineupSlotId: 11 },
        { playerId: 11, type: "LINEUP", fromLineupSlotId: 11, toLineupSlotId: 12 },
      ],
    });
  });

  it("refuses empty, no-op and unknown-slot moves", () => {
    expect(() => lineupTransactionBody(cfg, 13, 4, [])).toThrow(/no moves/);
    expect(() =>
      lineupTransactionBody(cfg, 13, 4, [{ playerId: 1, from: "BE", to: "BE" }]),
    ).toThrow(/no-op/);
    expect(() =>
      lineupTransactionBody(cfg, 13, 4, [{ playerId: 1, from: "BE", to: "XX" }]),
    ).toThrow(/unknown slot/);
  });
});

describe("submitLineup", () => {
  it("posts to the write host and reports success", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ status: "EXECUTED" }), { status: 200 }),
    );
    const res = await submitLineup(
      cfg,
      13,
      4,
      [{ playerId: 10, from: "BE", to: "PG" }],
      fetchImpl as unknown as typeof fetch,
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://lm-api-writes.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leagues/1/transactions/",
    );
    expect(init.method).toBe("POST");
    expect(res).toMatchObject({ ok: true, code: "EXECUTED" });
  });

  it("surfaces ESPN's typed rejection", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          details: [
            {
              type: "TRAN_LINEUP_LOCKED",
              message: "Lineup transaction could not be completed, is locked",
            },
          ],
        }),
        { status: 409 },
      );
    const res = await submitLineup(
      cfg,
      13,
      4,
      [{ playerId: 10, from: "BE", to: "PG" }],
      fetchImpl as typeof fetch,
    );
    expect(res).toMatchObject({ ok: false, httpStatus: 409, code: "TRAN_LINEUP_LOCKED" });
  });
});
