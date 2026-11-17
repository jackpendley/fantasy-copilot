import { describe, expect, it } from "vitest";
import { FAILURES_IN_A_ROW, failureAlertDue } from "@/lib/job-alerts";

describe("failure alerts", () => {
  it("come at once for the daily runs", () => {
    expect(failureAlertDue("nightly", ["error"])).toBe(true);
    expect(failureAlertDue("pregame", ["error", "ok"])).toBe(true);
    expect(failureAlertDue("nightly", ["ok", "error"])).toBe(false);
  });

  it("come for other steps only after failing several runs in a row", () => {
    const errors = Array<string>(FAILURES_IN_A_ROW).fill("error");
    expect(failureAlertDue("market-data", errors)).toBe(true);
    expect(failureAlertDue("market-data", errors.slice(1))).toBe(false);
    expect(failureAlertDue("market-data", ["error", "error", "ok"])).toBe(false);
    expect(failureAlertDue("market-data", ["ok", ...errors])).toBe(false);
  });
});
