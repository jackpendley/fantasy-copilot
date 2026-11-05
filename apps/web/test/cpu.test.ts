import { describe, expect, it } from "vitest";
import { CpuMeter } from "@/lib/cpu";

// Burn `ms` of this process's CPU time (not wall time: a busy CI machine gives less CPU).
const spin = (ms: number) => {
  const t0 = process.cpuUsage();
  let x = 0;
  for (;;) {
    for (let i = 0; i < 1e4; i++) x += Math.sqrt(x + 1);
    const u = process.cpuUsage(t0);
    if ((u.user + u.system) / 1000 >= ms) return x;
  }
};

describe("CPU meter", () => {
  it("adds each step's CPU, repeats included, and the total covers them", async () => {
    const m = new CpuMeter();
    await m.step("a", () => spin(30));
    await m.step("b", async () => spin(10));
    await m.step("a", () => spin(30));
    expect(m.steps.a!).toBeGreaterThanOrEqual(40);
    expect(m.steps.b!).toBeGreaterThanOrEqual(5);
    expect(m.ms).toBeGreaterThanOrEqual(m.steps.a! + m.steps.b! - 2);
  });

  it("still counts a step that throws", async () => {
    const m = new CpuMeter();
    await expect(
      m.step("boom", () => {
        spin(20);
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(m.steps.boom!).toBeGreaterThanOrEqual(10);
  });
});
