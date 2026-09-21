import { describe, expect, it } from "vitest";
import { HttpError } from "./HttpError";
import { getCurrentShiftAndDate, parseShift } from "./shift";

describe("parseShift", () => {
  it("accepts the two real shift values", () => {
    expect(parseShift("MORNING")).toBe("MORNING");
    expect(parseShift("NIGHT")).toBe("NIGHT");
  });

  it("rejects anything else with a 400, not a silent fallback", () => {
    expect(() => parseShift("EVENING")).toThrow(HttpError);
    expect(() => parseShift(undefined)).toThrow(HttpError);
    expect(() => parseShift(123)).toThrow(HttpError);
  });
});

// getCurrentShiftAndDate's whole point is the boundary behavior - a wrong
// hour comparison here means fulfillment silently posts into the wrong
// shift (Section 4.7) with no error anywhere to catch it.
describe("getCurrentShiftAndDate", () => {
  function at(hour: number, minute = 0): Date {
    return new Date(2026, 5, 15, hour, minute); // 2026-06-15, local time
  }

  it("is MORNING for the entire 7:00-15:59 window", () => {
    expect(getCurrentShiftAndDate(at(7, 0)).shift).toBe("MORNING");
    expect(getCurrentShiftAndDate(at(12, 30)).shift).toBe("MORNING");
    expect(getCurrentShiftAndDate(at(15, 59)).shift).toBe("MORNING");
  });

  it("flips to NIGHT exactly at 16:00, same calendar date", () => {
    const result = getCurrentShiftAndDate(at(16, 0));
    expect(result.shift).toBe("NIGHT");
    expect(result.date.toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  it("stays NIGHT through the rest of the evening", () => {
    expect(getCurrentShiftAndDate(at(23, 59)).shift).toBe("NIGHT");
  });

  it("just after midnight is still NIGHT, but belongs to the PREVIOUS calendar date", () => {
    // The night shift runs 4pm -> 1am, crossing midnight - 00:30 is still
    // that same night shift, and its "date" is the day the shift started
    // on, not the new calendar day the clock just rolled into.
    const result = getCurrentShiftAndDate(at(0, 30));
    expect(result.shift).toBe("NIGHT");
    expect(result.date.toISOString().slice(0, 10)).toBe("2026-06-14");
  });

  it("06:59 is still the previous night's shift (the 1am-7am gap)", () => {
    const result = getCurrentShiftAndDate(at(6, 59));
    expect(result.shift).toBe("NIGHT");
    expect(result.date.toISOString().slice(0, 10)).toBe("2026-06-14");
  });

  it("07:00 starts a fresh MORNING on today's date", () => {
    const result = getCurrentShiftAndDate(at(7, 0));
    expect(result.shift).toBe("MORNING");
    expect(result.date.toISOString().slice(0, 10)).toBe("2026-06-15");
  });
});
