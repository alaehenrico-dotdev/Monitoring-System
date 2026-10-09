/**
 * What a staged Manual Count draft means, independent of React.
 *
 * The Audit page stages every typed count as a string draft and flushes them
 * on Save. Three states have to be told apart, and getting it wrong is an
 * audit-data problem rather than a cosmetic one:
 *
 *   "12"  set this count to 12
 *   ""    on a cell that HAS a saved count   -> remove that count
 *   ""    on a cell that was never counted   -> nothing (an undone typo)
 *
 * The middle case used to be dropped along with the third: Save skipped every
 * empty draft, so clearing a counted cell deleted the draft, snapped the cell
 * back to the old figure, and left the count in the database still driving
 * the variance. The count looked cleared and never was.
 */

/// What Save should do with one staged draft.
export type DraftAction =
  | { kind: "set"; value: number }
  /// Sent as manualCount: null, which the server routes to deleteManualCount.
  | { kind: "clear" }
  /// Not a change (an undone typo, or the figure already saved) - dropped
  /// without a request.
  | { kind: "none" };

/**
 * `savedCount` is the last value the server has for this product+location,
 * or null when nothing has been counted there yet.
 *
 * A non-numeric draft resolves to "none" rather than throwing: the input is
 * type="number" so this is only reachable via a stale sessionStorage draft or
 * a hand-edited import, and silently skipping one bad cell is better than
 * failing the whole Save batch around it.
 */
export function draftAction(draft: string, savedCount: number | null): DraftAction {
  const trimmed = draft.trim();
  // Emptying a cell removes its count - except a saved 0, which an empty cell
  // and a 0 both read as "nothing here": clearing it is not a change, so it
  // must not light Save (see the 0-over-0 rule below).
  if (trimmed === "") return savedCount === null || savedCount === 0 ? { kind: "none" } : { kind: "clear" };

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return { kind: "none" };
  // Typing the figure that is already saved (0 over a saved 0 included) changes
  // nothing, so it must not light up Save or appear in the confirm list. A
  // never-counted cell (null) is different: a first count of 0 is a real result.
  if (savedCount !== null && value === savedCount) return { kind: "none" };
  return { kind: "set", value };
}

/// Whether this draft would write anything - what the Save button's count and
/// the confirm dialog's list both have to agree on. They disagreed before:
/// the button counted every draft while the dialog filtered empty ones out,
/// so clearing a count showed "Save (1)" above a dialog listing no changes.
export function isRealChange(draft: string, savedCount: number | null): boolean {
  return draftAction(draft, savedCount).kind !== "none";
}
