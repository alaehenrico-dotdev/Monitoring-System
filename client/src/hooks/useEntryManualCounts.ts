import { useEffect, useMemo, useState } from "react";
import { getManualCountGrid } from "../api/manualCounts";
import type { GridColumn, GridRow } from "../components/StockGrid";
import type { Shift, StockLocation } from "../types";
import { useRealtimeVersion } from "../context/RealtimeContext";
import { useResetOnKeyChange } from "./useResetOnKeyChange";

export const MANUAL_COUNT_KEY = "manualCount";

/// Import-only column for the Online/Offline Entry pages: the file's MANUAL
/// COUNTING column is read the same way Manual Count's own import reads it
/// (see ManualCountPage) and saved as that date/shift/location's manual count,
/// which is what the next period's opening stock starts from.
export const manualCountColumn: GridColumn = {
  key: MANUAL_COUNT_KEY,
  label: "Manual Count",
  importable: true,
  aliases: ["Manual Counting"],
};

/// Saved manual counts (productId -> count, null when not counted yet) for
/// one date/shift/location, so an import can tell what actually changed.
export function useEntryManualCounts(date: string, shift: Shift, location: StockLocation) {
  const [counts, setCounts] = useState<Record<number, number | null>>({});
  // False until this date/shift/location's counts have loaded, so an import
  // never diffs against a stale/empty set.
  const [loaded, setLoaded] = useState(false);
  const realtimeVersion = useRealtimeVersion();
  useResetOnKeyChange(`${date}:${shift}:${location}`, () => {
    setCounts({});
    setLoaded(false);
  });
  useEffect(() => {
    getManualCountGrid(date, shift, location)
      .then((grid) => {
        setCounts(
          Object.fromEntries(
            grid.map((r) => [r.product.id, r.entry.manualCount === null || r.entry.manualCount === undefined ? null : Number(r.entry.manualCount)]),
          ),
        );
        setLoaded(true);
      })
      .catch(() => {
        setCounts({});
        setLoaded(true);
      });
  }, [date, shift, location, realtimeVersion]);
  return { counts, loaded };
}

/// The grid rows with each product's saved manual count attached, for CsvTools.
export function useRowsWithManualCounts(rows: GridRow[] | null, counts: Record<number, number | null>) {
  return useMemo(
    () => rows?.map((r) => ({ ...r, entry: { ...r.entry, [MANUAL_COUNT_KEY]: counts[r.product.id] ?? null } })) ?? null,
    [rows, counts],
  );
}
