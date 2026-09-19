import { Shift } from "@prisma/client";
import { HttpError } from "./HttpError";

export function parseShift(value: unknown): Shift {
  if (value === "MORNING" || value === "NIGHT") return value;
  throw HttpError.badRequest('Expected shift to be "MORNING" or "NIGHT"');
}

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/**
 * Maps the current wall-clock time to the {shift, date} an encoder acting
 * right now is almost certainly working on - mirrors client/src/utils/
 * shift.ts's getCurrentShiftAndDate exactly (see that file for the full
 * reasoning about the midnight rollover and the 1am-7am gap). Kept in sync
 * here because receipts.service.ts's fulfillment auto-post needs today's
 * open shift and Receipt has no shift field of its own to read one from -
 * it always posts into whichever shift is open at the moment the receipt is
 * actually saved, not the (possibly backdated) order date.
 */
export function getCurrentShiftAndDate(now: Date = new Date()): { shift: Shift; date: Date } {
  const hour = now.getHours();

  if (hour >= 7 && hour < 16) return { shift: "MORNING", date: dateOnly(now) };
  if (hour >= 16) return { shift: "NIGHT", date: dateOnly(now) };

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return { shift: "NIGHT", date: dateOnly(yesterday) };
}
