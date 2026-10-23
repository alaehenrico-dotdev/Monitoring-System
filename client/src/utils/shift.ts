import type { Shift } from "../types";

export const SHIFTS: Shift[] = ["MORNING", "NIGHT"];

/// Whole-day mode (Settings > Entry Rules: shifts switched off): a day is one
/// sheet, kept as the Night sheet of the calendar date. Module state, set once
/// by ShiftModeGate before any page renders (and the page reloads if it
/// changes), so the many places that ask "what is the current shift/date" or
/// label a shift all follow it without each having to pass it around.
let wholeDay = false;

export function setWholeDayMode(on: boolean) {
  wholeDay = on;
}

export function isWholeDayMode(): boolean {
  return wholeDay;
}

export const SHIFT_LABELS: Record<Shift, string> = {
  MORNING: "Morning (7am\u20134pm)",
  get NIGHT() {
    return wholeDay ? "Daily Sheet" : "Night (4pm\u20131am)";
  },
};

/// A toolbar <select> only has room for a handful of characters once it's
/// squeezed down to its compact-mode width (.ae-toolbar--compact .ae-select
/// in index.css clamps every select to the same fixed max-width, whatever
/// its content, since it has no way to know one control's text is longer
/// than another's) - "Morning (7am-4pm)" past that point reads as a
/// half-cut string, not a shift name. ShiftFilter shows this short form
/// instead and keeps the full SHIFT_LABELS text as each option's tooltip,
/// so the hours are still one hover away without forcing the control wide
/// enough to fit them inline everywhere it's used.
export const SHIFT_SHORT_LABELS: Record<Shift, string> = {
  MORNING: "Morning",
  get NIGHT() {
    return wholeDay ? "Daily Sheet" : "Night";
  },
};

/// "Night Shift" / "Morning Shift" for running text - and just "Daily Sheet" for
/// the whole-day sheet, which is not a shift.
export function shiftWithWord(shift: Shift): string {
  return wholeDay && shift === "NIGHT" ? SHIFT_SHORT_LABELS.NIGHT : `${SHIFT_SHORT_LABELS[shift]} Shift`;
}

/// A shift taken from storage or a link, as the current mode allows it: with
/// shifts off there is only the whole-day sheet, so "Morning" becomes it.
export function coerceShift(shift: Shift): Shift {
  return wholeDay ? "NIGHT" : shift;
}

export function otherShift(shift: Shift): Shift {
  return shift === "MORNING" ? "NIGHT" : "MORNING";
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Maps the current wall-clock time to the {shift, date} an encoder opening
 * an entry page right now is almost certainly working on - so Online/
 * Offline Entry and Manual Count can default to it instead of making every
 * encoder pick both a date and a shift by hand on every visit.
 *
 * Night (4pm-1am) crosses midnight, so the shift can't be read off "time of
 * day" alone the way Morning can: 12:30am is still *last night's* Night
 * shift, filed under *yesterday's* business date, not a fresh shift on
 * today's date. Getting this wrong is exactly how an encoder logging in
 * just after midnight would silently start a second, nearly-empty Night
 * record instead of continuing the one still open from the evening before.
 *
 * 1am-7am falls between shifts (Night has ended, Morning hasn't started) -
 * default to the shift that most recently *closed* (Night, previous day)
 * rather than the one that hasn't opened yet, so a supervisor checking in
 * before opening sees last night's numbers instead of an empty Morning grid.
 */
/// The sheet the audit (Manual Count) opens on. Counting is done per night, so
/// the default is always a Night sheet: tonight's from 4pm, otherwise the most
/// recent one that has finished (before 7am that is last night's already, and
/// during the morning shift it is yesterday's).
export function getDefaultAuditSheet(now: Date = new Date()): { shift: Shift; date: string } {
  // A whole day is counted as it stands: today's sheet.
  if (wholeDay) return { shift: "NIGHT", date: isoDate(now) };
  const current = getCurrentShiftAndDate(now);
  if (current.shift === "NIGHT") return current;
  const [y, m, d] = current.date.split("-").map(Number);
  return { shift: "NIGHT", date: isoDate(new Date(y, m - 1, d - 1)) };
}

export function getCurrentShiftAndDate(now: Date = new Date()): { shift: Shift; date: string } {
  // Whole-day mode: one sheet per calendar date, whatever the hour - 4pm does
  // not cut the entry, and the date rolls over at midnight.
  if (wholeDay) return { shift: "NIGHT", date: isoDate(now) };
  const hour = now.getHours();

  if (hour >= 7 && hour < 16) {
    return { shift: "MORNING", date: isoDate(now) };
  }
  if (hour >= 16) {
    return { shift: "NIGHT", date: isoDate(now) };
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return { shift: "NIGHT", date: isoDate(yesterday) };
}