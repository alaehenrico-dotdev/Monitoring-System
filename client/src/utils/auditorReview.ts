import type { AdminSubmission, CountLocation } from "../api/countSubmissions";

/// The admin's side of an auditor's count: which figures the auditors gave for each cell of the
/// Audit table, which of them still need a decision, and what "use agreed counts" would stage.
/// An accepted figure is only ever STAGED - it becomes an ordinary unsaved count, saved and published
/// through the normal path - so nothing here writes anything.

export interface AuditorCount {
  auditorId: number;
  name: string;
  qty: number;
  note: string | null;
}

export const cellKey = (location: CountLocation, productId: number) => `${location}:${productId}`;

/// What each auditor submitted, by cell. Only SUBMITTED counts are here: a draft is still being
/// typed (and may be reopened work in progress), so it cannot be accepted.
export function buildAuditorCells(submissions: AdminSubmission[]): Map<string, AuditorCount[]> {
  const cells = new Map<string, AuditorCount[]>();
  for (const s of submissions) {
    if (s.status !== "SUBMITTED") continue;
    for (const l of s.lines) {
      if (l.qty === null) continue;
      const key = cellKey(l.location, l.productId);
      const list = cells.get(key) ?? [];
      list.push({ auditorId: s.auditor.id, name: s.auditor.name, qty: l.qty, note: l.note });
      cells.set(key, list);
    }
  }
  return cells;
}

/// Two auditors gave different figures for the same cell.
export const auditorsDisagree = (counts: AuditorCount[]) => counts.some((c) => c.qty !== counts[0].qty);

/// A cell still needs a decision unless the count in the table (saved or staged) already equals one of
/// the figures given - which is also how a disagreement is settled: pick one of them.
export const needsReview = (counts: AuditorCount[], current: number | null) => counts.length > 0 && (current === null || !counts.some((c) => c.qty === current));

export type CurrentCount = (location: CountLocation, productId: number) => number | null;

/// Whether any of these locations of a product still needs a decision.
export function rowNeedsReview(productId: number, locations: CountLocation[], cells: Map<string, AuditorCount[]>, current: CurrentCount): boolean {
  return locations.some((loc) => needsReview(cells.get(cellKey(loc, productId)) ?? [], current(loc, productId)));
}

export interface StageEdit {
  loc: CountLocation;
  productId: number;
  value: string;
}

/// What using ONE auditor's whole count would stage for the locations on screen: every figure they
/// submitted that the table does not already hold. Used when the admin clicks that auditor's banner.
export function planStageAuditor(submission: AdminSubmission, locations: CountLocation[], current: CurrentCount): StageEdit[] {
  if (submission.status !== "SUBMITTED") return [];
  const edits: StageEdit[] = [];
  for (const l of submission.lines) {
    if (l.qty === null || !locations.includes(l.location)) continue;
    if (current(l.location, l.productId) !== l.qty) edits.push({ loc: l.location, productId: l.productId, value: String(l.qty) });
  }
  return edits;
}
