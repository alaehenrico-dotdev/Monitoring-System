import type { Shift } from "../types";
import { ENTRY_PREFIX } from "./unsavedWork";
import { isWholeDayMode } from "./shift";

/**
 * Which sheet (date + shift) an entry page was last on, so coming back to the
 * page reopens it instead of jumping to the current shift - which made the
 * counts being encoded look lost, when they were still staged on the other
 * sheet.
 *
 * Only resumed while that sheet still holds unsaved edits. With nothing staged
 * there is nothing to protect, and a stale date left over from earlier would be
 * a trap rather than a convenience, so the page opens on the current shift as
 * it always did.
 */

const VIEW_PREFIX = "ala-eh-sheet-view:";

export type EntryPageKind = "online" | "offline";

export function rememberSheet(page: EntryPageKind, date: string, shift: Shift): void {
  try {
    sessionStorage.setItem(VIEW_PREFIX + page, JSON.stringify({ date, shift }));
  } catch {
    // best effort
  }
}

export function resumeSheet(page: EntryPageKind): { date: string; shift: Shift } | null {
  try {
    const raw = sessionStorage.getItem(VIEW_PREFIX + page);
    if (!raw) return null;
    const v = JSON.parse(raw) as { date?: unknown; shift?: unknown };
    if (typeof v.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return null;
    if (v.shift !== "MORNING" && v.shift !== "NIGHT") return null;
    // Shifts are off: there is no Morning sheet to go back to, so open the
    // whole-day sheet. Edits staged on a Morning sheet stay in storage, still
    // counted by the unsaved-work check, and come back if shifts are switched on.
    if (isWholeDayMode() && v.shift === "MORNING") return null;
    const staged = sessionStorage.getItem(`${ENTRY_PREFIX}${page}:${v.date}:${v.shift}`);
    if (!staged || Object.keys(JSON.parse(staged) as object).length === 0) return null;
    return { date: v.date, shift: v.shift };
  } catch {
    return null;
  }
}

export function clearSheetViews(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(VIEW_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // best effort
  }
}
