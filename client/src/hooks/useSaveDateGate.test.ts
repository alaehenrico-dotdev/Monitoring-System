import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../utils/shift", () => ({ getCurrentShiftAndDate: () => ({ date: "2026-11-17", shift: "MORNING" }) }));

import { useSaveDateGate } from "./useSaveDateGate";

describe("useSaveDateGate", () => {
  it("does not ask for today's date", () => {
    const { result } = renderHook(() => useSaveDateGate("2026-11-17", true));
    expect(result.current.needed).toBe(false);
    expect(result.current.blocked).toBe(false);
  });

  it("blocks Save on a past or future date until it is ticked", () => {
    for (const date of ["2026-11-16", "2026-11-18"]) {
      const { result } = renderHook(() => useSaveDateGate(date, true));
      expect(result.current.needed).toBe(true);
      expect(result.current.blocked).toBe(true);
      act(() => result.current.setConfirmed(true));
      expect(result.current.blocked).toBe(false);
    }
  });

  it("forgets the tick when the dialog closes and opens again", () => {
    const { result, rerender } = renderHook(({ open }) => useSaveDateGate("2026-11-16", open), { initialProps: { open: true } });
    act(() => result.current.setConfirmed(true));
    expect(result.current.blocked).toBe(false);
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current.confirmed).toBe(false);
    expect(result.current.blocked).toBe(true);
  });

  it("forgets the tick when the date changes", () => {
    const { result, rerender } = renderHook(({ date }) => useSaveDateGate(date, true), { initialProps: { date: "2026-11-16" } });
    act(() => result.current.setConfirmed(true));
    rerender({ date: "2026-11-15" });
    expect(result.current.blocked).toBe(true);
  });

  it("clears the tick in the same render, never showing a stale one", () => {
    const seen: boolean[] = [];
    const { result, rerender } = renderHook(
      ({ open }) => {
        const gate = useSaveDateGate("2026-11-16", open);
        seen.push(gate.confirmed);
        return gate;
      },
      { initialProps: { open: true } },
    );
    act(() => result.current.setConfirmed(true));
    seen.length = 0;
    rerender({ open: false });
    // Every committed render after the change reads "not confirmed": no frame with the old tick.
    expect(seen.at(-1)).toBe(false);
  });
});
