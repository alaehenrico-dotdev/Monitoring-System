import { useState } from "react";
import { Button, Select, TextInput } from "./ui";
import { isValidStockValue } from "../utils/gridFormat";

export interface FillTarget {
  key: string;
  label: string;
}

/**
 * The strip above a stock grid while rows are selected (StockGrid.tsx): what
 * is selected, and what can be done to all of it at once. Fill and Clear are
 * only offered when the grid can stage edits (`fillTargets` is null on a
 * read-only table), but Copy works everywhere.
 */
export function GridSelectionBar({
  count,
  fillTargets,
  onFill,
  onClearCells,
  clearLabel = "Clear cells",
  clearTitle = "Set every editable cell in the selected rows to 0 (Delete)",
  onCopy,
  onDeselect,
}: {
  count: number;
  fillTargets: FillTarget[] | null;
  onFill: (key: string, value: number) => void;
  /// Omitted (with `fillTargets` null) on a read-only table.
  onClearCells?: () => void;
  /// What clearing means here: "Clear cells" (set to 0) on the stock sheets,
  /// "Clear counts" (back to uncounted) on the Audit page.
  clearLabel?: string;
  clearTitle?: string;
  onCopy: () => void;
  onDeselect: () => void;
}) {
  const [fillKey, setFillKey] = useState("");
  const [value, setValue] = useState("");
  // The first column until one is picked; derived so a changed column list
  // can't leave a stale key selected.
  const key = fillTargets?.some((t) => t.key === fillKey) ? fillKey : (fillTargets?.[0]?.key ?? "");
  const canApply = value.trim() !== "" && isValidStockValue(value) && key !== "";

  return (
    <div className="ae-selection-bar no-print" role="toolbar" aria-label="Selected rows">
      <strong className="ae-selection-count">
        {count} row{count === 1 ? "" : "s"} selected
      </strong>
      {fillTargets && fillTargets.length > 0 && (
        <span className="ae-selection-fill">
          <Select
            aria-label="Column to fill"
            value={key}
            onChange={(e) => setFillKey(e.target.value)}
            style={{ width: "auto", minWidth: 120 }}
          >
            {fillTargets.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
          <TextInput
            type="number" onWheel={(e) => e.currentTarget.blur()}
            min={0}
            inputMode="decimal"
            aria-label="Value to fill"
            placeholder="Value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canApply) onFill(key, Number(value));
            }}
            style={{ width: 90 }}
          />
          <Button type="button" size="sm" disabled={!canApply} onClick={() => onFill(key, Number(value))}>
            Fill
          </Button>
        </span>
      )}
      {fillTargets && onClearCells && (
        <Button type="button" variant="secondary" size="sm" onClick={onClearCells} title={clearTitle}>
          {clearLabel}
        </Button>
      )}
      <Button type="button" variant="secondary" size="sm" onClick={onCopy} title="Copy the selected rows as a table you can paste into Excel (Ctrl+C)">
        Copy
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onDeselect} title="Clear the selection (Esc)" aria-label="Clear selection">
        &times;
      </Button>
    </div>
  );
}
