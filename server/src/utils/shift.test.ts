import { describe, expect, it } from "vitest";
import { HttpError } from "./HttpError";
import { parseShift } from "./shift";

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
