import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { workerAuthorized } from "@/lib/worker-auth";

const req = (auth?: string) =>
  new NextRequest("http://x/api/worker/next", { headers: auth ? { authorization: auth } : {} });

describe("worker requests", () => {
  it("need the worker secret", () => {
    process.env.WORKER_SECRET = "s3cret-for-test";
    expect(workerAuthorized(req("Bearer s3cret-for-test"))).toBe(true);
    expect(workerAuthorized(req("Bearer nope"))).toBe(false);
    expect(workerAuthorized(req())).toBe(false);
    delete process.env.WORKER_SECRET;
    expect(workerAuthorized(req("Bearer "))).toBe(false);
  });
});
