import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getCurrentShiftAndDate } from "../utils/shift";
import { useShiftWithSavedData } from "./useShiftWithSavedData";

const PAST = "2000-01-02";
const saved = [{ isSaved: true }];
const empty = [{ isSaved: false }, { isSaved: false }];

function run(over: Partial<Parameters<typeof useShiftWithSavedData>[0]> = {}) {
  const setShift = vi.fn();
  const props = { date: PAST, shift: "NIGHT" as const, rows: empty, otherShiftSaved: 12, hasPending: false, setShift, ...over };
  const view = renderHook((p) => useShiftWithSavedData(p), { initialProps: props });
  return { setShift, view, props };
}

describe("useShiftWithSavedData", () => {
  it("moves a past date with no saved rows to the other shift that has them", () => {
    const { setShift } = run();
    expect(setShift).toHaveBeenCalledExactlyOnceWith("MORNING");
  });

  it("works the other way round too", () => {
    const { setShift } = run({ shift: "MORNING" });
    expect(setShift).toHaveBeenCalledExactlyOnceWith("NIGHT");
  });

  it("stays put when this sheet already has saved rows", () => {
    expect(run({ rows: saved }).setShift).not.toHaveBeenCalled();
  });

  it("stays put when the other shift has nothing either", () => {
    expect(run({ otherShiftSaved: 0 }).setShift).not.toHaveBeenCalled();
  });

  it("never moves away from unsaved edits", () => {
    expect(run({ hasPending: true }).setShift).not.toHaveBeenCalled();
  });

  it("leaves today's empty sheet alone - a new shift starting is normal", () => {
    expect(run({ date: getCurrentShiftAndDate().date }).setShift).not.toHaveBeenCalled();
  });

  it("waits while either sheet is still loading", () => {
    expect(run({ rows: null }).setShift).not.toHaveBeenCalled();
    expect(run({ otherShiftSaved: null }).setShift).not.toHaveBeenCalled();
  });

  it("looks at each date once, so a shift picked by hand is respected", () => {
    const { setShift, view, props } = run();
    expect(setShift).toHaveBeenCalledTimes(1);
    // The user picks the empty shift again on the same date: no second push.
    view.rerender({ ...props, shift: "NIGHT", rows: [...empty] });
    expect(setShift).toHaveBeenCalledTimes(1);
  });

  it("looks again after the date changes", () => {
    const { setShift, view, props } = run();
    view.rerender({ ...props, date: "2000-01-03", rows: [...empty] });
    expect(setShift).toHaveBeenCalledTimes(2);
  });
});
