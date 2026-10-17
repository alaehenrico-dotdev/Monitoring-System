import type { MenuSection } from "../components/MenuBar";

const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 25;

/// The View menu's zoom items, for the pages that have a zoom control.
export function zoomSection(zoom: number, onChange: (zoom: number) => void): MenuSection {
  return {
    items: [
      { id: "zoom-in", label: "Zoom in", disabledReason: zoom >= ZOOM_MAX ? `Already at ${ZOOM_MAX}%` : undefined, onSelect: () => onChange(Math.min(ZOOM_MAX, zoom + ZOOM_STEP)) },
      { id: "zoom-out", label: "Zoom out", disabledReason: zoom <= ZOOM_MIN ? `Already at ${ZOOM_MIN}%` : undefined, onSelect: () => onChange(Math.max(ZOOM_MIN, zoom - ZOOM_STEP)) },
      { id: "zoom-reset", label: "Reset zoom (100%)", disabledReason: zoom === 100 ? "Already at 100%" : undefined, onSelect: () => onChange(100) },
    ],
  };
}
