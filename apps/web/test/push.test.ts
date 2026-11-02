import { describe, expect, it } from "vitest";
import { deliver } from "../lib/push";

const sub = (id: number) => ({
  id,
  endpoint: `https://push.example/${id}`,
  keys: { p256dh: "", auth: "" },
});
const fail = (statusCode: number) =>
  Object.assign(new Error(`status ${statusCode}`), { statusCode });

describe("deliver", () => {
  it("keeps sending after one device fails", async () => {
    const d = await deliver([sub(1), sub(2), sub(3), sub(4)], async (s) => {
      if (s.id === 1) throw fail(403); // made with an earlier key
      if (s.id === 2) throw fail(410); // unsubscribed
      if (s.id === 3) throw new Error("socket hang up");
    });
    expect(d.sent).toEqual([4]);
    expect(d.gone).toEqual([2]);
    expect(d.failed).toEqual([
      { id: 1, error: "403" },
      { id: 3, error: "socket hang up" },
    ]);
  });
});
