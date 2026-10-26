import { afterEach, describe, expect, it, vi } from "vitest";
import { formatHour, localHourToUtc, localSlotToUtc, utcHourToLocal, utcSlotToLocal, wholeHourOffset } from "./driveTime";

afterEach(() => vi.restoreAllMocks());

const zone = (minutesBehindUtc: number) =>
  vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(minutesBehindUtc);

describe("wholeHourOffset", () => {
  it("is how many hours the clock is ahead of UTC", () => {
    zone(-480); // Manila, UTC+8
    expect(wholeHourOffset()).toBe(8);
    zone(300); // New York in winter, UTC-5
    expect(wholeHourOffset()).toBe(-5);
    zone(0);
    expect(wholeHourOffset()).toBe(0);
  });

  it("is null in a half-hour zone, where a local hour is not a UTC hour", () => {
    zone(-330); // India, UTC+5:30
    expect(wholeHourOffset()).toBeNull();
    zone(-345); // Nepal, UTC+5:45
    expect(wholeHourOffset()).toBeNull();
  });
});

describe("converting the backup hour", () => {
  it("shows the stored UTC hour on the local clock - the default 18:00 UTC is 2 AM in Manila", () => {
    expect(utcHourToLocal(18, 8)).toBe(2);
    expect(formatHour(utcHourToLocal(18, 8))).toBe("2:00 AM");
  });

  it("turns the chosen local hour back into the UTC hour the server stores", () => {
    expect(localHourToUtc(2, 8)).toBe(18);
    expect(localHourToUtc(23, 8)).toBe(15);
  });

  it("round-trips every hour in every whole-hour zone", () => {
    for (let offset = -12; offset <= 14; offset++) {
      for (let h = 0; h < 24; h++) expect(localHourToUtc(utcHourToLocal(h, offset), offset)).toBe(h);
    }
  });

  it("wraps across midnight in both directions", () => {
    expect(utcHourToLocal(22, 8)).toBe(6);
    expect(utcHourToLocal(1, -5)).toBe(20);
    expect(localHourToUtc(1, 8)).toBe(17);
  });
});

describe("formatHour", () => {
  it("uses a 12-hour clock with no 0 o'clock", () => {
    expect(formatHour(0)).toBe("12:00 AM");
    expect(formatHour(12)).toBe("12:00 PM");
    expect(formatHour(13)).toBe("1:00 PM");
    expect(formatHour(23)).toBe("11:00 PM");
  });
});

describe("weekly slots (day + hour)", () => {
  it("the default, Friday 18:00 UTC, is Saturday 2:00 AM in Manila", () => {
    expect(utcSlotToLocal({ day: 5, hour: 18 }, 8)).toEqual({ day: 6, hour: 2 });
  });

  it("wraps from Saturday into Sunday and from Sunday back into Saturday", () => {
    expect(utcSlotToLocal({ day: 6, hour: 20 }, 8)).toEqual({ day: 0, hour: 4 });
    expect(utcSlotToLocal({ day: 0, hour: 2 }, -5)).toEqual({ day: 6, hour: 21 });
  });

  it("is reversible for every day, hour and whole-hour zone", () => {
    for (const offset of [-12, -5, 0, 5, 8, 14]) {
      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          expect(localSlotToUtc(utcSlotToLocal({ day, hour }, offset), offset)).toEqual({ day, hour });
        }
      }
    }
  });

  it("agrees with the hour-only helpers", () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(utcSlotToLocal({ day: 3, hour }, 8).hour).toBe(utcHourToLocal(hour, 8));
      expect(localSlotToUtc({ day: 3, hour }, 8).hour).toBe(localHourToUtc(hour, 8));
    }
  });
});
