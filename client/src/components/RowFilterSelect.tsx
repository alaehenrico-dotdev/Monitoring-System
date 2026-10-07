import { Dropdown } from "./Dropdown";
import { AlertTriangleIcon } from "./icons";
import { ROW_FILTER_LABELS, type RowFilter } from "../hooks/useGridView";

/// Narrows the entry grid to rows worth looking at: the ones this encoder has
/// edited but not yet saved, or the ones carrying a negative figure (which is
/// never a real stock reading and so always points at something to fix).
///
/// A third filter alongside SearchInput's free text and CategoryFilter's
/// exact category - all three compose, so "only negative, in Premium
/// (Liter)" is a valid view rather than one filter cancelling another.
export function RowFilterSelect({
  value,
  onChange,
  changedCount,
}: {
  value: RowFilter;
  onChange: (value: RowFilter) => void;
  /// Shown on the "Only changed" option so the count is visible before the
  /// filter is applied, not only after.
  changedCount?: number;
}) {
  return (
    <Dropdown
      aria-label="Filter rows"
      icon={<AlertTriangleIcon />}
      value={value}
      onChange={(v) => onChange(v as RowFilter)}
      options={[
        { value: "all", label: ROW_FILTER_LABELS.all },
        {
          value: "changed",
          label: changedCount
            ? `${ROW_FILTER_LABELS.changed} (${changedCount})`
            : ROW_FILTER_LABELS.changed,
        },
        { value: "negative", label: ROW_FILTER_LABELS.negative },
      ]}
    />
  );
}
