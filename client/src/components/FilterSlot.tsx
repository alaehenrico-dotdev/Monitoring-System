import type { ReactNode } from "react";
import { ClearIcon } from "./icons";

/**
 * Wraps one filter control and marks it when it is narrowing the view: an accent
 * dot and underline, plus words for a screen reader ("Category filter is on").
 * The mark is a shape and text, never only a colour, so a filter left on is
 * noticed by everyone - the commonest way to think the data is missing.
 *
 * It wraps the existing filter components rather than changing them, so each
 * keeps working exactly as it does elsewhere.
 */
export function FilterSlot({ active, label, children }: { active: boolean; label: string; children: ReactNode }) {
  return (
    <span className={`ae-filter${active ? " ae-filter--active" : ""}`}>
      {children}
      {active && <span className="ae-filter-dot" aria-hidden />}
      {active && <span className="ae-sr-only">{label} filter is on</span>}
    </span>
  );
}

/// Appears only while at least one filter is narrowing the view, and clears them
/// all at once.
export function ClearFilters({ count, onClear }: { count: number; onClear: () => void }) {
  if (count === 0) return null;
  return (
    <button type="button" className="ae-mb-btn ae-clear-filters" onClick={onClear} title={`Clear ${count} active filter${count === 1 ? "" : "s"}`}>
      <ClearIcon />
      <span>Clear filters</span>
    </button>
  );
}
