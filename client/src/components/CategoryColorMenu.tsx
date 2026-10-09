import { memo } from "react";
import { ColorSwatches } from "./ColorSwatches";
import { ContextMenu } from "./ContextMenu";

export interface CategoryMenuTarget {
  category: string;
  /// Viewport coordinates of the right-click.
  x: number;
  y: number;
}

/// Right-click menu on a category header row: pick a color for the bar, or
/// reset it to the default. Per browser (hooks/useColumnColors.ts), purely
/// visual.
export const CategoryColorMenu = memo(function CategoryColorMenu({
  target,
  color,
  customColor,
  onColorChange,
  onClose,
}: {
  target: CategoryMenuTarget;
  /// The row's current custom color, if it has one.
  color?: string;
  customColor: boolean;
  /// `null` puts the row back to the default bar color.
  onColorChange: (category: string, color: string | null) => void;
  onClose: () => void;
}) {
  return (
    <ContextMenu
      anchor={{ x: target.x, y: target.y }}
      title={target.category}
      ariaLabel={`${target.category} category options`}
      items={[
        {
          id: "reset-color",
          label: "Reset color",
          disabled: !customColor,
          run: () => onColorChange(target.category, null),
        },
      ]}
      footer={
        <ColorSwatches
          heading="Category color"
          subject={`${target.category} category color`}
          current={color}
          onChange={(hex) => onColorChange(target.category, hex)}
          onClose={onClose}
        />
      }
      onClose={onClose}
    />
  );
});
