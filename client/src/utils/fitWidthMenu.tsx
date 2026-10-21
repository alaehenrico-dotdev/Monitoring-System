import type { MenuItemDef } from "../components/MenuBar";
import { FitWidthIcon, CompactWidthIcon } from "../components/icons";

/// The View menu item that switches a table between its tight, content-sized
/// columns and columns stretched to fill the pane. It reads as the action it
/// will take, like "Expand all categories" / "Collapse all categories" above it.
export function fitWidthItem(fit: boolean, onChange: (fit: boolean) => void): MenuItemDef {
  return {
    id: "fit-width",
    label: fit ? "Compact table width" : "Fit table to width",
    icon: fit ? <CompactWidthIcon /> : <FitWidthIcon />,
    onSelect: () => onChange(!fit),
  };
}
