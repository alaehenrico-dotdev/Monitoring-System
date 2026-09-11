import { useEffect, useState, type CSSProperties } from "react";
import { MinusIcon, PlusIcon } from "./icons";

const MIN = 25;
const MAX = 200;
const STEP = 25;
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
 * Excel-style zoom toggle: 25%-200% in 25% steps. Rendered as a single
 * segmented pill - [−] | 100% ▾ | [+] - the way Figma, Google Docs, and
 * Excel itself present a zoom control, rather than three separately
 * bordered boxes with gaps between them.
 */
export function ZoomControl({ zoom, onChange }: { zoom: number; onChange: (zoom: number) => void }) {
  return (
    <div className="ae-segment-group" aria-label="Zoom" title="Zoom">
      <button
        type="button"
        className="ae-segment-btn ae-segment-btn-icon"
        aria-label="Zoom out"
        onClick={() => onChange(zoom - STEP)}
        disabled={zoom <= MIN}
      >
        <MinusIcon />
      </button>
      <div className="ae-segment-divider" />
      <select
        className="ae-segment-select"
        aria-label="Zoom level"
        value={zoom}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {PRESETS.map((p) => (
          <option key={p} value={p}>
            {p}%
          </option>
        ))}
      </select>
      <div className="ae-segment-divider" />
      <button
        type="button"
        className="ae-segment-btn ae-segment-btn-icon"
        aria-label="Zoom in"
        onClick={() => onChange(zoom + STEP)}
        disabled={zoom >= MAX}
      >
        <PlusIcon />
      </button>
    </div>
  );
}

/// Apply to the direct wrapper of a table/grid to scale it Excel-style.
export function zoomStyle(zoom: number): CSSProperties {
  return { zoom: `${zoom}%` } as CSSProperties;
}
