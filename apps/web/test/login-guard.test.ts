import { describe, expect, it } from "vitest";
import { clientIp, passwordMatches } from "@/lib/login-guard";

describe("the password check", () => {
  it("accepts only the exact password", () => {
    expect(passwordMatches("synthetic-pw", "synthetic-pw")).toBe(true);
    expect(passwordMatches("synthetic-pW", "synthetic-pw")).toBe(false);
    expect(passwordMatches("synthetic-pw ", "synthetic-pw")).toBe(false);
    expect(passwordMatches("", "synthetic-pw")).toBe(false);
  });

  it("refuses everything when no password is set, and non-strings", () => {
    expect(passwordMatches("", undefined)).toBe(false);
    expect(passwordMatches("", "")).toBe(false);
    expect(passwordMatches(undefined, "synthetic-pw")).toBe(false);
    expect(passwordMatches({ toString: () => "synthetic-pw" }, "synthetic-pw")).toBe(false);
  });
});

describe("the client address", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("is the first forwarded address, else the real-ip header", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(h({ "x-real-ip": "203.0.113.8" }))).toBe("203.0.113.8");
    expect(clientIp(h({}))).toBe("unknown");
  });
});
