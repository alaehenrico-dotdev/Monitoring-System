import { memo } from "react";
import { MAX_EXTRAS_PER_COLUMN } from "../hooks/useExtraColumns";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

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

/**
 * The right-click menu on an editable Online/Offline grid column header -
 * add extra input columns after it, or delete ones already added.
 *
 * Only the item list lives here now; the popover itself (positioning,
 * keyboard navigation, dismissal, styling) is ContextMenu, shared with the
 * grid's cell menu.
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
  const added = target.added;
  const room = MAX_EXTRAS_PER_COLUMN - added.length;
  const full = room <= 0;

  const items: ContextMenuItem[] = [
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

  return (
    <ContextMenu
      anchor={{ x: target.x, y: target.y }}
      title={target.label}
      ariaLabel={`${target.label} column options`}
      items={items}
      onClose={onClose}
    />
  );
});
