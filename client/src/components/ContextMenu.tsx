import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
  run: () => void;
}

export interface ContextMenuAnchor {
  /// Viewport coordinates of the right-click, or of the focused element's
  /// own corner when opened from the keyboard.
  x: number;
  y: number;
}

/**
 * The app's one floating menu shell - a portaled popover with keyboard
 * navigation, viewport nudging and the standard dismissals (Escape, outside
 * click, scroll, resize, picking anything).
 *
 * Extracted from ColumnHeaderMenu when the grid grew a second menu (cell
 * right-click), rather than letting a near-copy of all of this behaviour
 * drift alongside the original. Callers supply a title and a list of items;
 * everything about how a menu *behaves* lives here exactly once.
 *
 * Portaled rather than rendered in place, for the same stacking reasons as
 * Modal/DatePicker: the grid is a sticky-header scroll container that would
 * otherwise clip it. `memo` so the grid re-rendering (a keystroke in some
 * cell) doesn't re-run the menu.
 */
export const ContextMenu = memo(function ContextMenu({
  anchor,
  title,
  ariaLabel,
  items,
  onClose,
}: {
  anchor: ContextMenuAnchor;
  title: string;
  ariaLabel: string;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });

  // Nudged back inside the viewport once the real size is known, so a
  // right-click near the right/bottom edge doesn't open a menu half off-screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(anchor.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(anchor.y, window.innerHeight - height - 8)),
    });
    el.focus();
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    // Capture, so the grid's own scroll container closes it too - a menu
    // anchored to a cell that has scrolled away is just litter.
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  function run(item: ContextMenuItem) {
    if (item.disabled) return;
    item.run();
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + items.length) % items.length);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : items.length - 1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const item = items[active];
      if (item) run(item);
    }
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={ariaLabel}
      className="ae-col-menu no-print"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ae-col-menu-title">{title}</div>
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          title={item.title}
          className={[
            "ae-col-menu-item",
            item.danger ? "ae-col-menu-item--danger" : "",
            i === active ? "ae-col-menu-item--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onMouseEnter={() => setActive(i)}
          onClick={() => run(item)}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
});
