import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFitWidth } from "./useFitWidth";

afterEach(() => localStorage.clear());

describe("useFitWidth", () => {
  it("starts off, so nothing changes for anyone until they turn it on", () => {
    const { result } = renderHook(() => useFitWidth("manual-count"));
    expect(result.current[0]).toBe(false);
  });

  it("remembers the choice across reloads", () => {
    const first = renderHook(() => useFitWidth("manual-count"));
    act(() => first.result.current[1](true));
    first.unmount();
    expect(renderHook(() => useFitWidth("manual-count")).result.current[0]).toBe(true);
  });

  it("keeps each page's choice separate", () => {
    const audit = renderHook(() => useFitWidth("manual-count"));
    act(() => audit.result.current[1](true));
    expect(renderHook(() => useFitWidth("total-stocks")).result.current[0]).toBe(false);
  });

  it("can be turned back off, and that is remembered too", () => {
    const first = renderHook(() => useFitWidth("daily-report"));
    act(() => first.result.current[1](true));
    act(() => first.result.current[1](false));
    first.unmount();
    expect(renderHook(() => useFitWidth("daily-report")).result.current[0]).toBe(false);
  });

  it("still works when storage is blocked", () => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    try {
      const { result } = renderHook(() => useFitWidth("manual-count"));
      expect(result.current[0]).toBe(false);
      act(() => result.current[1](true));
      expect(result.current[0]).toBe(true);
    } finally {
      Storage.prototype.getItem = get;
    }
  });
});
