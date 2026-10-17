import { describe, expect, it } from "vitest";
import { makeThrottle } from "./throttle";

describe("makeThrottle", () => {
  it("lets the first call through and holds the rest until the interval has passed", () => {
    let t = 1_000;
    const gate = makeThrottle(30_000, () => t);
    expect(gate.allow()).toBe(true);
    t += 5_000;
    expect(gate.allow()).toBe(false);
    t += 24_999;
    expect(gate.allow()).toBe(false);
    t += 1;
    expect(gate.allow()).toBe(true);
  });

  it("measures the next interval from the call that was let through, not from the held ones", () => {
    let t = 0;
    const gate = makeThrottle(10_000, () => t);
    expect(gate.allow()).toBe(true);
    t = 9_000;
    expect(gate.allow()).toBe(false); // held calls do not push the window back
    t = 10_000;
    expect(gate.allow()).toBe(true);
  });

  it("works from a clock that starts at zero", () => {
    const gate = makeThrottle(1_000, () => 0);
    expect(gate.allow()).toBe(true);
    expect(gate.allow()).toBe(false);
  });
});
