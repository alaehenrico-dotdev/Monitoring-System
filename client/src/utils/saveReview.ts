import type { Shift } from "../types";
import { formatDateLong } from "./dateFormat";
import { getCurrentShiftAndDate, shiftWithWord } from "./shift";

/// What the Save review dialog says besides the list of changes: the things worth
/// stopping for before a Save writes to the database. Pure, so each rule is tested.
export interface SaveNotice {
  /// "warn" is something that changes history or will block later; "info" is
  /// context. Neither blocks the Save - the dialog is a confirmation, not a gate.
  tone: "warn" | "info";
  text: string;
}

interface RowLike {
  product: { id: number; name: string };
  entry: Record<string, unknown>;
}

/// Rows this Save touches that would END below zero stock, from the rows as they
/// show with the staged edits applied (and Remaining Stock recomputed).
export function rowsEndingNegative(displayRows: RowLike[] | null | undefined, pending: Record<number, unknown>): { name: string; remaining: number }[] {
  const out: { name: string; remaining: number }[] = [];
  for (const row of displayRows ?? []) {
    if (!(row.product.id in pending)) continue;
    const remaining = Number(row.entry.remainingStock);
    if (Number.isFinite(remaining) && remaining < 0) out.push({ name: row.product.name, remaining });
  }
  return out;
}

export function saveNotices({
  date,
  shift,
  negatives = [],
  otherShiftWarning = null,
  alsoUpdates = null,
  now = getCurrentShiftAndDate(),
}: {
  date: string;
  shift: Shift;
  negatives?: { name: string; remaining: number }[];
  /// The page's own "the other shift already has entries" text, when it has one.
  otherShiftWarning?: string | null;
  /// Which other table this Save also writes to (a transfer is mirrored), if any.
  alsoUpdates?: string | null;
  now?: { date: string; shift: Shift };
}): SaveNotice[] {
  const notices: SaveNotice[] = [];

  if (date < now.date) {
    notices.push({
      tone: "warn",
      text: `${formatDateLong(date)} is a past day, not today. Saving changes recorded history, and the days after it are recalculated from it.`,
    });
  } else if (date > now.date) {
    notices.push({ tone: "warn", text: `${formatDateLong(date)} is a future day - check it is the date you meant.` });
  } else if (shift !== now.shift) {
    notices.push({ tone: "info", text: `${shiftWithWord(shift)} is not the shift that is open now (${shiftWithWord(now.shift)}).` });
  }

  if (negatives.length > 0) {
    const shown = negatives.slice(0, 5).map((n) => `${n.name} (${n.remaining.toLocaleString()})`).join(", ");
    const more = negatives.length > 5 ? ` and ${negatives.length - 5} more` : "";
    notices.push({
      tone: "warn",
      text: `${negatives.length} product${negatives.length === 1 ? "" : "s"} will end below zero stock: ${shown}${more}. It saves, but Finish Day will not close this sheet until it is corrected or a supervisor signs it off.`,
    });
  }

  if (alsoUpdates) notices.push({ tone: "info", text: `Transfer figures in this save are also written to the ${alsoUpdates} table.` });
  if (otherShiftWarning) notices.push({ tone: "info", text: otherShiftWarning });
  return notices;
}
