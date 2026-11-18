import { describe, expect, it } from "vitest";
import { lastNightly, readSinceNightly } from "@/lib/nightly-fresh";

describe("values the nightly job writes are read once after each nightly run", () => {
  it("finds the latest nightly finish (11:30 UTC)", () => {
    expect(lastNightly(Date.parse("2026-11-17T23:20:00Z"))).toBe(
      Date.parse("2026-11-17T11:30:00Z"),
    );
    expect(lastNightly(Date.parse("2026-11-17T11:30:00Z"))).toBe(
      Date.parse("2026-11-17T11:30:00Z"),
    );
    expect(lastNightly(Date.parse("2026-11-17T11:29:00Z"))).toBe(
      Date.parse("2026-11-16T11:30:00Z"),
    );
  });

  it("keeps a value read after the nightly all day, and re-reads it after the next one", () => {
    const read = Date.parse("2026-11-17T12:00:00Z");
    expect(readSinceNightly(read, Date.parse("2026-11-17T23:59:00Z"))).toBe(true);
    expect(readSinceNightly(read, Date.parse("2026-11-18T11:29:00Z"))).toBe(true);
    expect(readSinceNightly(read, Date.parse("2026-11-18T11:31:00Z"))).toBe(false);
    // Read before this morning's nightly finished: stale once it has.
    expect(
      readSinceNightly(Date.parse("2026-11-17T11:10:00Z"), Date.parse("2026-11-17T11:45:00Z")),
    ).toBe(false);
  });
});
