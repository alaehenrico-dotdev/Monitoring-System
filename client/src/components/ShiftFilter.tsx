import { Dropdown } from "./Dropdown";
import type { Shift } from "../types";
import { SHIFTS, SHIFT_LABELS, SHIFT_SHORT_LABELS } from "../utils/shift";

/// A toolbar dropdown for the two operating shifts - same reusable-Dropdown
/// shape as CategoryFilter. Used both where a shift is required (Online/
/// Offline Entry, Manual Count - one record per product/date/shift, so
/// there's no "all shifts" option) and where it's an optional report filter
/// (`includeAll`, mirroring CategoryFilter's "All categories").
///
/// Options show the short "Morning"/"Night" form, not the full
/// "Morning (7am-4pm)" label - the toolbar's compact mode clips every
/// dropdown to the same fixed width regardless of what's inside it, so the
/// long form gets truncated into something unreadable there. The full
/// description is still available as a hover tooltip (on the trigger for
/// the current selection, on each option while the list is open) via
/// Dropdown's per-option `title`.
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
    <Dropdown
      aria-label="Shift"
      value={value}
      onChange={(v) => onChange(v as Shift | "")}
      options={[
        ...(includeAll ? [{ value: "", label: "All shifts" }] : []),
        ...SHIFTS.map((s) => ({ value: s, label: SHIFT_SHORT_LABELS[s], title: SHIFT_LABELS[s] })),
      ]}
    />
  );
}
