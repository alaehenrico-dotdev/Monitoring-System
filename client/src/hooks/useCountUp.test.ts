import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCountUp } from "./useCountUp";

let frames: FrameRequestCallback[] = [];
const runFrame = (at: number) => act(() => frames.shift()?.(at));

function stubMotion(reduced: boolean) {
  window.matchMedia = ((q: string) => ({ matches: reduced, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  frames = [];
  stubMotion(false);
  vi.spyOn(performance, "now").mockReturnValue(1000);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => vi.unstubAllGlobals());

function start(target: number) {
  const hook = renderHook(({ t }) => useCountUp(t), { initialProps: { t: undefined as number | undefined } });
  hook.rerender({ t: target });
  return hook;
}

describe("useCountUp", () => {
  it("counts up to the target and stops there", () => {
    const { result } = start(500);
    runFrame(1350); // halfway through the 700ms
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(500);
    runFrame(1700);
    expect(result.current).toBe(500);
  });

  it("never dips below its start when a frame's timestamp precedes the start time", () => {
    // A frame can begin before the effect that scheduled it ran, so its
    // timestamp is slightly earlier than the start time. That used to give a
    // negative progress and a negative figure for a frame.
    const { result } = start(11_000);
    runFrame(990);
    expect(result.current).toBe(0);
    runFrame(1010);
    expect(result.current).toBeGreaterThanOrEqual(0);
  });

  it("counts down without overshooting either end", () => {
    const hook = start(100);
    runFrame(1700);
    hook.rerender({ t: 20 });
    runFrame(900);
    expect(hook.result.current).toBeLessThanOrEqual(100);
    expect(hook.result.current).toBeGreaterThanOrEqual(20);
  });

  it("shows the number at once for anyone who asks for reduced motion", () => {
    stubMotion(true);
    const { result } = start(500);
    expect(result.current).toBe(500);
    expect(frames).toHaveLength(0);
  });
});
