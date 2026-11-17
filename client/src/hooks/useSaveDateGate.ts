import { useState } from "react";
import { getCurrentShiftAndDate } from "../utils/shift";

/**
 * The "is this the right date?" check in the Save review dialog (Online, Offline and Manual Count).
 *
 * Today's sheet saves as before. For any other date (a past day, or a future one) the dialog asks for a
 * tick before Save works, so a sheet opened on the wrong day, or left on yesterday after midnight,
 * can't be saved by habit. Asking only then keeps the tick meaningful: it is rare enough to be read.
 * The tick is cleared every time the dialog opens or closes and whenever the date changes.
 */
export function useSaveDateGate(date: string, open: boolean) {
  const needed = date !== getCurrentShiftAndDate().date;
  const [confirmed, setConfirmed] = useState(false);
  // Reset by comparing during render (React's own pattern for state that follows a prop) instead of
  // in an effect, which would paint one frame with the old tick before clearing it.
  const key = `${date}|${open}`;
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setConfirmed(false);
  }
  return { needed, confirmed, setConfirmed, blocked: needed && !confirmed };
}

export type SaveDateGate = ReturnType<typeof useSaveDateGate>;
