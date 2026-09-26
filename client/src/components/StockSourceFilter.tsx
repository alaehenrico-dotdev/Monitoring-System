import { Dropdown } from "./Dropdown";
import type { StockLocation } from "../types";

/// A toolbar dropdown for the Total Stocks page - same reusable-Dropdown
/// shape as CategoryFilter/ShiftFilter. Narrows the remaining-stock table
/// to just the Online or Offline channel, or shows both side by side
/// (default). Reuses the existing StockLocation type ("TOTAL" standing in
/// for "Both") rather than introducing a parallel enum.
export function StockSourceFilter({
  value,
  onChange,
}: {
  value: StockLocation;
  onChange: (value: StockLocation) => void;
}) {
  return (
    <Dropdown
      aria-label="Stock source"
      value={value}
      onChange={(v) => onChange(v as StockLocation)}
      options={[
        { value: "TOTAL", label: "Online + Offline" },
        { value: "ONLINE", label: "Online only" },
        { value: "OFFLINE", label: "Offline only" },
      ]}
    />
  );
}
