/// The server schedules the daily backup in UTC (it has no idea what time zone
/// the business works in); people think in their own clock. These convert the
/// stored UTC hour to the hour on this browser's clock and back, so the setting
/// reads "2:00 AM" for someone in Manila while the server stores 18.

/// Whole hours this browser's clock is ahead of UTC (Manila: 8), or null for a
/// half-hour zone such as India (+5:30), where a whole local hour is not a
/// whole UTC hour - the page then shows UTC hours instead of guessing.
export function wholeHourOffset(date: Date = new Date()): number | null {
  const minutesAhead = -date.getTimezoneOffset();
  // `|| 0` turns the -0 that a UTC clock produces into a plain 0.
  return minutesAhead % 60 === 0 ? minutesAhead / 60 || 0 : null;
}

const wrap = (h: number) => ((h % 24) + 24) % 24;

export const utcHourToLocal = (utcHour: number, offset: number) => wrap(utcHour + offset);
export const localHourToUtc = (localHour: number, offset: number) => wrap(localHour - offset);

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/// A weekly slot is a day (0 = Sunday ... 6 = Saturday) and an hour. Moving it
/// between UTC and the local clock can cross midnight, which changes the day too
/// (UTC Friday 18:00 is Saturday 2:00 AM in Manila), so the two move together.
export interface Slot {
  day: number;
  hour: number;
}

function shiftSlot(slot: Slot, hours: number): Slot {
  const total = slot.day * 24 + slot.hour + hours;
  return { day: (((Math.floor(total / 24) % 7) + 7) % 7), hour: wrap(total) };
}

export const utcSlotToLocal = (utc: Slot, offset: number): Slot => shiftSlot(utc, offset);
export const localSlotToUtc = (local: Slot, offset: number): Slot => shiftSlot(local, -offset);

/// 0 -> "12:00 AM", 14 -> "2:00 PM".
export function formatHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${hour < 12 ? "AM" : "PM"}`;
}
