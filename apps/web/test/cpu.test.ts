import { describe, expect, it } from "vitest";
import { CpuMeter } from "@/lib/cpu";

const spin = (ms: number) => {
  const end = performance.now() + ms;
  let x = 0;
  while (performance.now() < end) x += Math.sqrt(x + 1);
  return x;
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
