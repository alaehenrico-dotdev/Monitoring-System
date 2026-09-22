import { useEffect, useState, type CSSProperties } from "react";
import { Select } from "./ui";

const MIN = 50;
const MAX = 200;
const PRESETS = [50, 75, 100, 125, 150, 175, 200];

function clamp(value: number): number {
  return Math.min(MAX, Math.max(MIN, value));
}

/// Persists a page's zoom level per-viewer (localStorage), namespaced by
/// `key` so Online Entry, Offline Entry, Manual Count, and Total Stocks each
/// remember their own zoom independently.
export function useZoom(key: string) {
  const storageKey = `ala-eh-zoom:${key}`;

  const [zoom, setZoom] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      return Number.isFinite(saved) && saved > 0 ? clamp(saved) : 100;
    } catch {
      return 100;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(zoom));
    } catch {
      // Per-viewer convenience only - fine to silently skip if unavailable.
    }
  }, [zoom, storageKey]);

  return [zoom, (next: number) => setZoom(clamp(next))] as const;
}

/**
 * Excel-style zoom level, 50%-200% in 25% steps. Floored at 50% (rather
 * than the 25% Excel itself allows) - the hover ring/spotlight and cursor
 * effects in RowGlowScroll.tsx are keyed to the table's on-screen row
 * geometry, which gets too small to track reliably below half size.
 *
 * This is intentionally a single native select so it behaves like the other
 * toolbar filter controls.
 *
 * Its SIZE is owned entirely by the `.ae-zoom-control` rules in index.css
 * (a fixed width per toolbar tier). Do not set width / minWidth / maxWidth /
 * flex inline here: the toolbar measures hidden clones of its children to
 * pick a tier, and inline sizing that disagrees with the stylesheet makes
 * the real row wider than what was measured - that mismatch is what made
 * the toolbar pop horizontal scrollbars on pages with a zoom control.
 * Only sizing-neutral styling (padding, alignment) stays inline.
 */
export function ZoomControl({
  zoom,
  onChange,
}: {
  zoom: number;
  onChange: (zoom: number) => void;
}) {
  return (
    <Select
      className="ae-zoom-control"
      aria-label="Zoom level"
      title="Zoom"
      value={zoom}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        boxSizing: "border-box",
        paddingLeft: 8,
        paddingRight: 26,
        textAlign: "right",
      }}
    >
      {PRESETS.map((p) => (
        <option key={p} value={p}>
          {p}%
        </option>
      ))}
    </Select>
  );
}

/// Apply to the direct wrapper of a table/grid to scale it Excel-style.
export function zoomStyle(zoom: number): CSSProperties {
  return { zoom: `${zoom}%` } as CSSProperties;
}