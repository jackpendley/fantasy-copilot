import { describe, expect, it } from "vitest";
import { retrying } from "../src/retry";

describe("retrying", () => {
  it("returns the first success, trying again after each failure", async () => {
    let calls = 0;
    const out = await retrying(async () => {
      if (++calls < 3) throw new Error("HTTP 502");
      return "ok";
    }, [0, 0, 0]);
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up with the last error once the waits run out", async () => {
    let calls = 0;
    await expect(
      retrying(async () => {
        throw new Error(`fail ${++calls}`);
      }, [0, 0]),
    ).rejects.toThrow("fail 3");
  });
});
