import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { CLOSE_MS, useCategoryReveal } from "./useCategoryReveal";

function stubMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  stubMotion(false);
});
afterEach(() => {
  vi.useRealTimers();
  // @ts-expect-error - restore the jsdom default (no matchMedia)
  delete window.matchMedia;
});

describe("useCategoryReveal", () => {
  it("expanding applies at once and fades the rows in, then lets go of the class", () => {
    const { result } = renderHook(() => useCategoryReveal());
    const apply = vi.fn();
    act(() => result.current.toggle("Sauces", false, true, apply));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.rowClass("Sauces")).toBe(" ae-row-opening");
    expect(result.current.closing("Sauces")).toBe(false);

    act(() => void vi.advanceTimersByTime(200));
    expect(result.current.rowClass("Sauces")).toBe("");
  });

  it("collapsing fades out first and only applies after the fade", () => {
    const { result } = renderHook(() => useCategoryReveal());
    const apply = vi.fn();
    act(() => result.current.toggle("Sauces", true, true, apply));
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.rowClass("Sauces")).toBe(" ae-row-closing");
    expect(result.current.closing("Sauces")).toBe(true); // so the chevron can turn at once

    act(() => void vi.advanceTimersByTime(CLOSE_MS - 1));
    expect(apply).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.rowClass("Sauces")).toBe("");
  });

  it("a second click during the fade-out cancels the collapse", () => {
    const { result } = renderHook(() => useCategoryReveal());
    const apply = vi.fn();
    act(() => result.current.toggle("Sauces", true, true, apply));
    act(() => void vi.advanceTimersByTime(60));
    act(() => result.current.toggle("Sauces", true, true, apply));
    act(() => void vi.advanceTimersByTime(500));
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.rowClass("Sauces")).toBe("");
  });

  it("does not fade out a category that unsaved edits force open: it would fade, then pop back", () => {
    const { result } = renderHook(() => useCategoryReveal());
    const apply = vi.fn();
    act(() => result.current.toggle("Sauces", true, false, apply));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.rowClass("Sauces")).toBe("");
  });

  it("animates each category on its own", () => {
    const { result } = renderHook(() => useCategoryReveal());
    act(() => result.current.toggle("Sauces", true, true, vi.fn()));
    expect(result.current.rowClass("Sauces")).toBe(" ae-row-closing");
    expect(result.current.rowClass("Vinegar")).toBe("");
  });

  it("with reduced motion, applies at once and never adds a class", () => {
    stubMotion(true);
    const { result } = renderHook(() => useCategoryReveal());
    const apply = vi.fn();
    act(() => result.current.toggle("Sauces", true, true, apply));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.rowClass("Sauces")).toBe("");
  });

  it("without a browser to ask (tests), applies at once", () => {
    // @ts-expect-error - no matchMedia, as in jsdom
    delete window.matchMedia;
    const { result } = renderHook(() => useCategoryReveal());
    const apply = vi.fn();
    act(() => result.current.toggle("Sauces", true, true, apply));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("does not run a pending collapse after the table is gone", () => {
    const { result, unmount } = renderHook(() => useCategoryReveal());
    const apply = vi.fn();
    act(() => result.current.toggle("Sauces", true, true, apply));
    unmount();
    vi.advanceTimersByTime(500);
    expect(apply).not.toHaveBeenCalled();
  });
});
