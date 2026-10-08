import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MAX_EXTRAS_PER_COLUMN } from "../hooks/useExtraColumns";

export interface ColumnMenuTarget {
  mainKey: string;
  label: string;
  /// Viewport coordinates of the right-click (or of the header's own corner,
  /// when opened from the keyboard).
  x: number;
  y: number;
  /// Slot numbers of the columns already added after this one.
  added: number[];
}

interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
  run: () => void;
}

/**
 * The right-click menu on an editable Online/Offline grid column header -
 * add extra input columns after it, or delete ones already added.
 *
 * A portaled popover rather than an in-table dropdown, for the same stacking
 * reasons as Modal/DatePicker: the grid is a sticky-header scroll container
 * that would otherwise clip it. Styling matches the app's other floating
 * panels (.ae-col-menu in index.css - charcoal surface, 0.5px edge, 8px
 * radius), and it closes on Escape, an outside click, a scroll, a resize, or
 * picking anything.
 *
 * `memo` so the grid re-rendering (a keystroke in some cell) doesn't re-run
 * the menu - its props are a small object the grid only replaces when the
 * menu actually opens or moves.
 */
export const ColumnHeaderMenu = memo(function ColumnHeaderMenu({
  target,
  onAdd,
  onRemove,
  onClose,
}: {
  target: ColumnMenuTarget;
  onAdd: (mainKey: string, count: number) => void;
  onRemove: (mainKey: string, slots: number[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  const added = target.added;
  const room = MAX_EXTRAS_PER_COLUMN - added.length;
  const full = room <= 0;

  const items: MenuItem[] = [
    ...[1, 2, 5].map((n) => ({
      id: `add-${n}`,
      label: `Add column: +${n}`,
      disabled: full,
      title: full
        ? `${target.label} already has the maximum of ${MAX_EXTRAS_PER_COLUMN} added columns`
        : n > room
          ? `Only ${room} more can be added - this adds ${room}`
          : undefined,
      run: () => onAdd(target.mainKey, n),
    })),
    ...(added.length
      ? [
          {
            id: "del-last",
            label: `Delete added column +${added[added.length - 1]}`,
            danger: true,
            run: () => onRemove(target.mainKey, [added[added.length - 1]]),
          },
          {
            id: "del-all",
            label: `Delete all ${added.length} added column${added.length === 1 ? "" : "s"}`,
            danger: true,
            run: () => onRemove(target.mainKey, added),
          },
        ]
      : []),
  ];

  // Nudged back inside the viewport once the real size is known, so a
  // right-click near the right/bottom edge doesn't open a menu half off-screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(target.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(target.y, window.innerHeight - height - 8)),
    });
    el.focus();
  }, [target.x, target.y]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    // Capture, so the grid's own scroll container closes it too - a menu
    // anchored to a header that has scrolled away is just litter.
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  function run(item: MenuItem) {
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
      run(items[active]);
    }
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={`${target.label} column options`}
      className="ae-col-menu no-print"
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ae-col-menu-title">{target.label}</div>
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
