import { useEffect, useState, type CSSProperties } from "react";
import { Select } from "./ui";

const MIN = 25;
const MAX = 200;
const PRESETS = [25, 50, 75, 100, 125, 150, 175, 200];

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
 * Excel-style zoom level, 25%-200% in 25% steps - a single dropdown button
 * showing the current level; picking a preset applies it immediately. One
 * control, same shape as every other toolbar dropdown (category/location
 * filters), rather than its own one-off [-] | 100% | [+] segmented pill.
 */
export function ZoomControl({ zoom, onChange }: { zoom: number; onChange: (zoom: number) => void }) {
  return (
    <Select aria-label="Zoom level" title="Zoom" value={zoom} onChange={(e) => onChange(Number(e.target.value))}>
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
