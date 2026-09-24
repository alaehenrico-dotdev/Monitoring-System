/**
 * Finds staged-but-unsaved edits left behind by the Online Entry, Offline
 * Entry and Manual Count pages.
 *
 * Those pages keep in-progress work in sessionStorage (see
 * hooks/usePendingEntryChanges.ts and ManualCountPage.tsx) so it survives
 * navigating away. That's also the only way another page - like a report -
 * can tell that something is still unsaved, since the entry pages' own React
 * state is gone once they unmount.
 *
 * The key prefixes below must stay in sync with the storage keys those pages
 * build:
 *   ala-eh-pending:online:<date>:<shift>
 *   ala-eh-pending:offline:<date>:<shift>
 *   ala-eh-manual-count-pending:<date>:<shift>:<location>
 */

// Exported so hooks/usePendingEntryChanges.ts's clearAllPendingEntryState
// (Data Reset's client-side cleanup) can wipe exactly these same prefixes
// rather than duplicating them as a second set of magic strings that could
// silently drift out of sync with the ones actually written here.
export const ENTRY_PREFIX = "ala-eh-pending:";
export const MANUAL_COUNT_PREFIX = "ala-eh-manual-count-pending:";

// Receipts page drafts (single form + bulk sheet) - see pages/ReceiptsPage.tsx.
// Not an "unsaved edit against a saved grid" like the two above, so
// findUnsavedWork ignores it; it's only here so Data Reset can wipe it too.
export const RECEIPT_DRAFT_PREFIX = "ala-eh-receipts-draft:";

export type UnsavedWorkPage = "Online Entry" | "Offline Entry" | "Manual Count";

export interface UnsavedWorkItem {
  page: UnsavedWorkPage;
  /// Where the person can go to save it.
  route: string;
  date: string;
  /// "Morning" / "Night"
  shift: string;
  /// Manual Count only: "Online" / "Offline" / "Total".
  location?: string;
  /// How many products have staged changes.
  count: number;
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function countStaged(raw: string | null): number {
  if (!raw) return 0;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" ? Object.keys(value).length : 0;
  } catch {
    return 0;
  }
}

/**
 * Unsaved edits whose date falls within [from, to] (inclusive, "YYYY-MM-DD").
 *
 * Scoped to the report's own dates on purpose: a report only goes stale
 * because of edits to the days it covers, and an old abandoned edit for some
 * unrelated day shouldn't block every report from being generated.
 *
 * Best effort, like the storage writes themselves - blocked site data just
 * means nothing is found.
 */
export function findUnsavedWork({ from, to }: { from: string; to: string }): UnsavedWorkItem[] {
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const found: UnsavedWorkItem[] = [];

  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key) continue;

      let item: Omit<UnsavedWorkItem, "count"> | null = null;
      if (key.startsWith(ENTRY_PREFIX)) {
        const [kind, date, shift] = key.slice(ENTRY_PREFIX.length).split(":");
        if (kind === "online" || kind === "offline") {
          item = {
            page: kind === "online" ? "Online Entry" : "Offline Entry",
            route: kind === "online" ? "/online" : "/offline",
            date,
            shift: titleCase(shift ?? ""),
          };
        }
      } else if (key.startsWith(MANUAL_COUNT_PREFIX)) {
        const [date, shift, location] = key.slice(MANUAL_COUNT_PREFIX.length).split(":");
        item = { page: "Manual Count", route: "/manual-count", date, shift: titleCase(shift ?? ""), location: titleCase(location ?? "") };
      }

      if (!item || !item.date || item.date < lo || item.date > hi) continue;
      const count = countStaged(sessionStorage.getItem(key));
      if (count > 0) found.push({ ...item, count });
    }
  } catch {
    return [];
  }

  return found.sort((a, b) => a.date.localeCompare(b.date) || a.page.localeCompare(b.page) || a.shift.localeCompare(b.shift));
}