import type { ReactNode } from "react";
import { EllipsisIcon } from "./icons";
import { ClearFilters } from "./FilterSlot";
import { MenuBar, type MenuDef, type MenuItemDef, type MenuSection } from "./MenuBar";

/**
 * A button in the bar's own style. `primary` is the one filled button on a bar;
 * an unavailable button stays visible (dashed and dimmed, never just greyed) and
 * says why in its tooltip and to a screen reader. It is aria-disabled, not
 * disabled, so it stays focusable and the reason can be read.
 */
export function BarButton({
  label,
  icon,
  onClick,
  disabledReason,
  primary = false,
  title,
  shortcut,
}: {
  label: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  disabledReason?: string;
  primary?: boolean;
  title?: string;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      className={`ae-mb-btn${primary ? " ae-mb-btn--primary" : ""}`}
      aria-disabled={disabledReason ? true : undefined}
      title={disabledReason ?? title}
      aria-keyshortcuts={shortcut}
      onClick={() => !disabledReason && onClick()}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/**
 * The menu-bar toolbar for pages that are not the entry sheets: the same bar
 * (index.css, ".ae-mb"), assembled from what the page gives it.
 *
 *   menus     text menus on the left (Edit / View / Export ...), each holding the
 *             less-frequent actions. Leave out for a page that has none.
 *   filters   always visible, after a divider. They wrap onto a second row when
 *             the bar is too narrow rather than disappearing.
 *   primary   the page's one filled action, right-aligned.
 *   actions   any other controls on the right, before the primary.
 *   trailing  the far-right control (zoom).
 *
 * At a narrow width the menus fold into one "..." menu built from the same
 * items, so nothing is reachable in one layout and missing in another.
 */
export function PageToolbar({
  label,
  menus = [],
  filters,
  actions,
  primary,
  trailing,
  overflowExtra = [],
  activeFilters = 0,
  onClearFilters,
}: {
  label: string;
  menus?: MenuDef[];
  filters?: ReactNode;
  actions?: ReactNode;
  primary?: ReactNode;
  trailing?: ReactNode;
  overflowExtra?: MenuSection[];
  /// How many filters are narrowing the view; with onClearFilters it shows "Clear filters".
  activeFilters?: number;
  onClearFilters?: () => void;
}) {
  const flat = (sections: MenuSection[]): MenuItemDef[] => sections.flatMap((s) => s.items);
  const overflow: MenuDef = {
    id: "more",
    label: "More actions",
    icon: <EllipsisIcon />,
    sections: [...menus.map((m) => ({ heading: m.label, items: flat(m.sections) })), ...overflowExtra],
  };
  const hasMenus = menus.length > 0;
  // A menu holding a single item is just a button: opening a menu for one choice
  // is a click wasted. The "..." menu still lists it.
  const itemsOf = (m: MenuDef) => flat(m.sections);
  const dropdowns = menus.filter((m) => itemsOf(m).length !== 1);
  const buttons = menus.filter((m) => itemsOf(m).length === 1).map((m) => itemsOf(m)[0]);

  return (
    <div className="ae-toolbar ae-mb ae-mb--page no-print">
      {/* Always the row's first child (the shared toolbar rules key on it); empty
          and hidden when the page has no menus. */}
      <div className="ae-mb-menus" style={hasMenus ? undefined : { display: "none" }}>
        {dropdowns.length > 0 && <MenuBar label={`${label} menus`} menus={dropdowns} />}
        {buttons.map((item) => (
          <BarButton key={item.id} label={item.label} icon={item.icon} disabledReason={item.disabledReason} onClick={() => item.onSelect?.(document.body)} />
        ))}
      </div>
      {hasMenus && filters && <span className="ae-mb-divider" aria-hidden />}

      {filters && (
        <div className="ae-mb-filters">
          {filters}
          {onClearFilters && <ClearFilters count={activeFilters} onClear={onClearFilters} />}
        </div>
      )}

      <div className="ae-mb-spacer" />

      <div className="ae-mb-actions">
        {actions}
        {primary}
        {trailing && <span className="ae-mb-zoom">{trailing}</span>}
        {hasMenus && (
          <span className="ae-mb-overflow">
            <MenuBar label="More actions" menus={[overflow]} />
          </span>
        )}
      </div>
    </div>
  );
}
