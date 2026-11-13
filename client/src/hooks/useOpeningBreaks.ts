import { useEffect, useState } from "react";
import { getManualCountGrid } from "../api/manualCounts";
import type { Shift, StockLocation } from "../types";

export type OpeningBreaks = Record<number, { expected: number; actual: number }>;

const NONE: OpeningBreaks = {};

/// Products on this sheet whose Opening stock is not what the previous period
/// carries forward (a CSV import set it) - productId -> expected vs actual.
///
/// The server already works this out for the Audit page (the same answer, so the
/// two never disagree, including the "an audit published since then" cases a
/// client-side comparison would get wrong); this reads it from there and hands it
/// to the grid as a marker on the Opening cell.
///
/// Best effort: if the call fails or is slow the sheet simply shows no markers -
/// it never blocks or delays entry. Refetched with `refreshKey` (realtime
/// version, reconnects, manual refresh) so a correction made elsewhere clears it.
export function useOpeningBreaks(date: string, shift: Shift, location: Extract<StockLocation, "ONLINE" | "OFFLINE">, refreshKey: string | number, enabled = true): OpeningBreaks {
  // Held with the sheet it was read for, so a slow answer for a sheet the
  // encoder has already left is never shown on the new one.
  const [state, setState] = useState<{ key: string; breaks: OpeningBreaks }>({ key: "", breaks: NONE });
  const sheetKey = `${location}:${date}:${shift}`;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getManualCountGrid(date, shift, location)
      .then((rows) => {
        if (cancelled) return;
        const breaks: OpeningBreaks = {};
        for (const r of rows) if (r.openingBreak) breaks[r.product.id] = r.openingBreak;
        setState({ key: sheetKey, breaks });
      })
      .catch(() => {
        if (!cancelled) setState({ key: sheetKey, breaks: NONE });
      });
    return () => {
      cancelled = true;
    };
  }, [date, shift, location, refreshKey, enabled, sheetKey]);

  return enabled && state.key === sheetKey ? state.breaks : NONE;
}
