import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  beginActivity,
  getActivitySnapshot,
  MIN_SHOW_MS,
  resetActivity,
  resolveActivity,
  setConnecting,
  SHOW_AFTER_MS,
  SLOW_AFTER_MS,
  useActivity,
} from "./activity";

beforeEach(() => {
  vi.useFakeTimers();
  resetActivity();
});
afterEach(() => {
  resetActivity();
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
// Store changes happen inside act(), as they do in a real render cycle, so the hook
// re-renders (and starts its timers) before the fake clock moves on.
const begin = () => {
  let end!: () => void;
  act(() => {
    end = beginActivity();
  });
  return () => act(() => end());
};

describe("resolveActivity", () => {
  const raw = (over = {}) => ({ count: 0, oldest: null as number | null, connecting: false, ...over });

  it("is idle when nothing is happening", () => {
    expect(resolveActivity(raw(), 1000)).toBe("idle");
  });
  it("is busy while a request runs", () => {
    expect(resolveActivity(raw({ count: 1, oldest: 900 }), 1000)).toBe("busy");
  });
  it("is slow once the oldest request has waited long enough, and not a moment before", () => {
    expect(resolveActivity(raw({ count: 2, oldest: 0 }), SLOW_AFTER_MS - 1)).toBe("busy");
    expect(resolveActivity(raw({ count: 2, oldest: 0 }), SLOW_AFTER_MS)).toBe("slow");
  });
  it("is connecting while the live connection (re)connects, ahead of everything else", () => {
    expect(resolveActivity(raw({ connecting: true }), 0)).toBe("connecting");
    expect(resolveActivity(raw({ connecting: true, count: 1, oldest: 0 }), SLOW_AFTER_MS + 1)).toBe("connecting");
  });
});

describe("the request counter", () => {
  it("counts requests in flight and remembers when the oldest started", () => {
    vi.setSystemTime(1_000);
    const a = beginActivity();
    vi.setSystemTime(2_000);
    const b = beginActivity();
    expect(getActivitySnapshot()).toMatchObject({ count: 2, oldest: 1_000 });
    a();
    expect(getActivitySnapshot()).toMatchObject({ count: 1, oldest: 2_000 });
    b();
    expect(getActivitySnapshot()).toMatchObject({ count: 0, oldest: null });
  });

  it("ending the same request twice does not end another one", () => {
    const a = beginActivity();
    beginActivity();
    a();
    a();
    expect(getActivitySnapshot().count).toBe(1);
  });
});

describe("useActivity - what the beam shows", () => {
  it("shows nothing for a request that finishes quickly, so instant calls never flash it", () => {
    const { result } = renderHook(() => useActivity());
    const end = begin();
    advance(SHOW_AFTER_MS - 50);
    end();
    advance(2000);
    expect(result.current).toBe("idle");
  });

  it("shows busy once a request has lasted past the delay", () => {
    const { result } = renderHook(() => useActivity());
    begin();
    advance(SHOW_AFTER_MS - 1);
    expect(result.current).toBe("idle");
    advance(2);
    expect(result.current).toBe("busy");
  });

  it("stays up for a minimum time even when the request ends right after it appeared", () => {
    const { result } = renderHook(() => useActivity());
    const end = begin();
    advance(SHOW_AFTER_MS + 1);
    expect(result.current).toBe("busy");
    end();
    advance(MIN_SHOW_MS - 100);
    expect(result.current).toBe("busy");
    advance(200);
    expect(result.current).toBe("idle");
  });

  it("turns slow when a request keeps waiting, then back to idle when it ends", () => {
    const { result } = renderHook(() => useActivity());
    const end = begin();
    advance(SLOW_AFTER_MS - 100);
    expect(result.current).toBe("busy");
    advance(200);
    expect(result.current).toBe("slow");
    end();
    advance(MIN_SHOW_MS + 100);
    expect(result.current).toBe("idle");
  });

  it("shows connecting while the live connection (re)connects, and clears it when connected", () => {
    const { result } = renderHook(() => useActivity());
    act(() => setConnecting(true));
    advance(SHOW_AFTER_MS + 1);
    expect(result.current).toBe("connecting");
    act(() => setConnecting(false));
    advance(MIN_SHOW_MS + 100);
    expect(result.current).toBe("idle");
  });

  it("a quick first connection does not flash the beam", () => {
    const { result } = renderHook(() => useActivity());
    act(() => setConnecting(true));
    advance(100);
    act(() => setConnecting(false));
    advance(2000);
    expect(result.current).toBe("idle");
  });

  it("connecting takes over from busy while it lasts, and busy returns after it", () => {
    const { result } = renderHook(() => useActivity());
    begin();
    advance(SHOW_AFTER_MS + 1);
    expect(result.current).toBe("busy");
    act(() => setConnecting(true));
    expect(result.current).toBe("connecting");
    act(() => setConnecting(false));
    expect(result.current).toBe("busy");
  });

  it("several overlapping requests keep it on until the last one ends", () => {
    const { result } = renderHook(() => useActivity());
    const a = begin();
    const b = begin();
    advance(SHOW_AFTER_MS + 1);
    a();
    advance(MIN_SHOW_MS + 100);
    expect(result.current).toBe("busy");
    b();
    advance(MIN_SHOW_MS + 100);
    expect(result.current).toBe("idle");
  });

  it("a new request during the hide delay keeps it on instead of blinking", () => {
    const { result } = renderHook(() => useActivity());
    const a = begin();
    advance(SHOW_AFTER_MS + 1);
    a();
    advance(300);
    begin();
    advance(MIN_SHOW_MS * 2);
    expect(result.current).toBe("busy");
  });
});
