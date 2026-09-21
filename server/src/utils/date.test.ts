import { describe, expect, it } from "vitest";
import { HttpError } from "./HttpError";
import { parseDateOnly, toDateOnlyString } from "./date";

describe("parseDateOnly", () => {
  it("parses a well-formed YYYY-MM-DD string to UTC midnight", () => {
    const date = parseDateOnly("2026-03-05");
    expect(date.toISOString()).toBe("2026-03-05T00:00:00.000Z");
  });

  it.each([undefined, null, 42, "", "03/05/2026", "2026-3-5", "2026-13-01", "not-a-date"])(
    "rejects %p with a 400, not a crash or a silently-wrong date",
    (value) => {
      expect(() => parseDateOnly(value)).toThrow(HttpError);
    },
  );
});

describe("toDateOnlyString", () => {
  it("round-trips through parseDateOnly", () => {
    expect(toDateOnlyString(parseDateOnly("2026-12-25"))).toBe("2026-12-25");
  });
});
