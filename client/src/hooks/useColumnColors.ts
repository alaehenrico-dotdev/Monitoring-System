import { useCallback, useState } from "react";

/**
 * Per-browser header colors for the entry grids' editable columns (header
 * right-click menu, components/ColumnHeaderMenu.tsx) and for category header
 * rows (components/CategoryColorMenu.tsx).
 *
 * Purely visual and purely local - the same reasoning as the added-column
 * names in StockGrid: it's how one encoder likes to read the sheet, not part
 * of any entry, so it lives in localStorage rather than being saved or
 * staged. `scope` namespaces Online from Offline, which share column keys
 * (productionIn exists on both).
 */

const HEX = /^#[0-9a-f]{6}$/i;

function load(storageKey: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Hand-edited storage shouldn't be able to inject anything but a color.
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && HEX.test(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/// Readable label color for a header filled with `hex`: the brand near-black
/// on light fills, white on dark ones (the pastel tones are all "light").
export function inkFor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? "#0C0C0C" : "#FFFFFF";
}

function makeColorHook(storageKey: string) {
  return function useColors(scope: string) {
    const [colors, setColors] = useState<Record<string, string>>(() =>
      load(storageKey),
    );

    const getColor = useCallback(
      (key: string): string | undefined => colors[`${scope}:${key}`],
      [colors, scope],
    );

    /// `null` clears the override, putting it back to its default look.
    const setColor = useCallback(
      (key: string, color: string | null) => {
        if (color !== null && !HEX.test(color)) return;
        setColors((prev) => {
          const next = { ...prev };
          const k = `${scope}:${key}`;
          if (color === null) delete next[k];
          else next[k] = color.toLowerCase();
          try {
            localStorage.setItem(storageKey, JSON.stringify(next));
          } catch {
            // A preference - fine to lose rather than block the menu.
          }
          return next;
        });
      },
      [scope],
    );

    return { getColor, setColor };
  };
}

/// Editable column headers on the entry grids (keyed by column key).
export const useColumnColors = makeColorHook("ala-eh-grid-column-colors");

/// Category header rows (keyed by category name) - on the entry grids and the
/// Audit page.
export const useCategoryColors = makeColorHook("ala-eh-grid-category-colors");
