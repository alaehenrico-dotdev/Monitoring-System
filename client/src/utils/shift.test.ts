import { describe, expect, it } from "vitest";
import { getCurrentShiftAndDate, otherShift } from "./shift";

describe("getCurrentShiftAndDate", () => {
  it("is Morning, same date, from 7:00am up to (not including) 4:00pm", () => {
    expect(getCurrentShiftAndDate(new Date(2026, 5, 15, 7, 0))).toEqual({ shift: "MORNING", date: "2026-06-15" });
    expect(getCurrentShiftAndDate(new Date(2026, 5, 15, 12, 30))).toEqual({ shift: "MORNING", date: "2026-06-15" });
    expect(getCurrentShiftAndDate(new Date(2026, 5, 15, 15, 59))).toEqual({ shift: "MORNING", date: "2026-06-15" });
  });

  it("is Night, same date, from 4:00pm up to (not including) midnight", () => {
    expect(getCurrentShiftAndDate(new Date(2026, 5, 15, 16, 0))).toEqual({ shift: "NIGHT", date: "2026-06-15" });
    expect(getCurrentShiftAndDate(new Date(2026, 5, 15, 20, 0))).toEqual({ shift: "NIGHT", date: "2026-06-15" });
    expect(getCurrentShiftAndDate(new Date(2026, 5, 15, 23, 59))).toEqual({ shift: "NIGHT", date: "2026-06-15" });
  });

  it("is still last night's Night shift, filed under YESTERDAY's date, from midnight up to 7:00am", () => {
    // The exact case this function exists for: an encoder opening the app
    // just after midnight is still on the shift that started the evening
    // before, not a brand-new one on today's date.
    expect(getCurrentShiftAndDate(new Date(2026, 5, 16, 0, 0))).toEqual({ shift: "NIGHT", date: "2026-06-15" });
    expect(getCurrentShiftAndDate(new Date(2026, 5, 16, 3, 30))).toEqual({ shift: "NIGHT", date: "2026-06-15" });
    expect(getCurrentShiftAndDate(new Date(2026, 5, 16, 6, 59))).toEqual({ shift: "NIGHT", date: "2026-06-15" });
  });

  it("carries the month/year backward correctly when yesterday was the last day of a month (or year)", () => {
    expect(getCurrentShiftAndDate(new Date(2026, 6, 1, 2, 0))).toEqual({ shift: "NIGHT", date: "2026-06-30" });
    expect(getCurrentShiftAndDate(new Date(2027, 0, 1, 2, 0))).toEqual({ shift: "NIGHT", date: "2026-12-31" });
  });

  it("never reads the UTC calendar date - only the local wall-clock date/hour matter", () => {
    // A bare `new Date(y, m, d, h, min)` (used throughout this file, and by
    // every real caller - DatePicker, the entry pages) is constructed from
    // LOCAL components and read back with the equally-local getHours/
    // getFullYear/etc. this function uses - unlike `new Date().toISOString()`
    // (the bug this guards against, see TotalStocksPage/VarianceReportPage's
    // own fixes, which used to build their own "today" this way instead of
    // reusing this function), there is no implicit UTC conversion anywhere
    // in this path for a timezone ahead of UTC (this app's own, Asia/Manila)
    // to be caught out by.
    expect(getCurrentShiftAndDate(new Date(2026, 5, 16, 0, 30)).date).toBe("2026-06-15");
  });
});

describe("otherShift", () => {
  it("swaps Morning and Night", () => {
    expect(otherShift("MORNING")).toBe("NIGHT");
    expect(otherShift("NIGHT")).toBe("MORNING");
  });
});
