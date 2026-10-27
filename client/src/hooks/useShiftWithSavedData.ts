import { useEffect, useRef } from "react";
import type { Shift } from "../types";
import { getCurrentShiftAndDate, otherShift } from "../utils/shift";

/**
 * Stepping to a past date keeps the shift you were on. If that date was entered
 * under the OTHER shift, the sheet you land on has no saved rows and looks wiped,
 * with the real data one click away. This moves to the shift that holds it.
 *
 * It only acts when all of these are true, so it never gets in the way:
 *  - the date is before the current business day (today's empty sheet is just a
 *    new shift starting - that is normal, and stays put);
 *  - the sheet is loaded and has no saved row, while the other shift has some;
 *  - nothing is staged on this sheet (unsaved edits are never moved away from);
 *  - it hasn't already looked at this date, so a shift the user then picks by hand
 *    is respected, and the two sheets can never bounce back and forth.
 *
 * `rows`/`otherShiftSaved` are null while loading, which is a "wait".
 */
export function useShiftWithSavedData({
  date,
  shift,
  rows,
  otherShiftSaved,
  hasPending,
  setShift,
}: {
  date: string;
  shift: Shift;
  rows: { isSaved?: boolean }[] | null;
  otherShiftSaved: number | null;
  hasPending: boolean;
  setShift: (shift: Shift) => void;
}) {
  const looked = useRef<string | null>(null);
  useEffect(() => {
    if (rows === null || otherShiftSaved === null) return;
    if (looked.current === date) return;
    looked.current = date;
    if (date >= getCurrentShiftAndDate().date) return;
    if (hasPending || rows.some((r) => r.isSaved) || otherShiftSaved === 0) return;
    // A one-off reaction to data arriving, not derivable during render.
    setShift(otherShift(shift));
  }, [date, shift, rows, otherShiftSaved, hasPending, setShift]);
}
