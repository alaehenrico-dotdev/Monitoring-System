import { Select } from "./ui";
import type { Shift } from "../types";
import { SHIFTS, SHIFT_LABELS, SHIFT_SHORT_LABELS } from "../utils/shift";

/// A toolbar dropdown for the two operating shifts - same reusable-Select
/// shape as CategoryFilter. Used both where a shift is required (Online/
/// Offline Entry, Manual Count - one record per product/date/shift, so
/// there's no "all shifts" option) and where it's an optional report filter
/// (`includeAll`, mirroring CategoryFilter's "All categories").
///
/// Options show the short "Morning"/"Night" form, not the full
/// "Morning (7am-4pm)" label - the toolbar's compact mode clips every
/// select to the same fixed width regardless of what's inside it, so the
/// long form gets truncated into something unreadable there. The full
/// description is still available as a hover tooltip (on the control for
/// the current selection, on each option while the list is open).
export function ShiftFilter({
  value,
  onChange,
  includeAll = false,
}: {
  value: Shift | "";
  onChange: (value: Shift | "") => void;
  includeAll?: boolean;
}) {
  return (
    <Select
      aria-label="Shift"
      value={value}
      onChange={(e) => onChange(e.target.value as Shift | "")}
      title={value ? SHIFT_LABELS[value] : undefined}
    >
      {includeAll && <option value="">All shifts</option>}
      {SHIFTS.map((s) => (
        <option key={s} value={s} title={SHIFT_LABELS[s]}>
          {SHIFT_SHORT_LABELS[s]}
        </option>
      ))}
    </Select>
  );
}