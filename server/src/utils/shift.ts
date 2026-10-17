import { Shift } from "@prisma/client";
import { HttpError } from "./HttpError";

/// The period immediately before this one in the Morning -> Night -> next
/// Morning chain. Dates are UTC-midnight business dates (see parseDateOnly).
export function previousPeriod(entryDate: Date, shift: Shift): { entryDate: Date; shift: Shift } {
  if (shift === "NIGHT") return { entryDate, shift: "MORNING" };
  const previous = new Date(entryDate);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return { entryDate: previous, shift: "NIGHT" };
}

export function parseShift(value: unknown): Shift {
  if (value === "MORNING" || value === "NIGHT") return value;
  throw HttpError.badRequest('Expected shift to be "MORNING" or "NIGHT"');
}
