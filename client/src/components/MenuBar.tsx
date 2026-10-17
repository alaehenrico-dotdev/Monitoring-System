import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BanIcon, CheckIcon, ChevronIcon } from "./icons";

/** One row of a menu. */
export interface MenuItemDef {
  id: string;
  label: string;
  icon?: ReactNode;
  /// Shown right-aligned. List a shortcut ONLY if something really binds it: a
  /// hint for a key that does nothing is worse than no hint.
  shortcut?: string;
  /// `anchor` is the menu's own trigger, for an action that opens something
  /// hanging under it (a popover).
  onSelect?: (anchor: HTMLElement | null) => void;
  /// Set => the item is disabled. It stays visible and readable (dimmed, with an
  /// icon), stays focusable, and this is its tooltip AND its screen-reader
  /// description - so "why can't I?" always has an answer.
  disabledReason?: string;
  /// Present => a choice among several (role menuitemradio); true marks the
  /// current one with a check, so it never depends on colour.
  checked?: boolean;
  tone?: "danger";
}

/** A run of related items; sections are separated by a rule, and may be titled. */
export interface MenuSection {
  heading?: string;
  items: MenuItemDef[];
}

export interface MenuDef {
  id: string;
  label: string;
  sections: MenuSection[];
  /// The trigger shows only this icon (the label is still its accessible name).
  icon?: ReactNode;
}

type FocusOn = "first" | "last";

interface MenuPanelProps {
  /// What the panel hangs under, and what a click on is not "outside".
  anchor: HTMLElement;
  label: string;
  sections: MenuSection[];
  focusOn?: FocusOn;
  align?: "start" | "end";
  /// `restoreFocus`: give focus back to whatever opened the menu (Esc, Tab, or an
  /// item chosen) rather than leaving it where the pointer went (outside click).
  onClose: (restoreFocus: boolean) => void;
  /// Left/Right inside a menu: step to the neighbouring menu (menu bar only).
  onSwitch?: (direction: -1 | 1) => void;
}

/// "Ctrl+Z" -> "Control+Z", the form aria-keyshortcuts wants.
const ariaShortcut = (shortcut: string) => shortcut.replace(/\bCtrl\b/g, "Control");

/**
 * The popup list shared by the menu bar and the split button's chevron.
 *
 * It follows the WAI-ARIA menu pattern with a roving tabindex: Up/Down move
 * (wrapping), Home/End jump, a letter jumps to the next item starting with it,
 * Enter/Space choose, Esc closes and returns focus to the trigger, Left/Right
 * move to the neighbouring menu. Tab closes it and carries on - focus is never
 * trapped - and a click outside closes it. There is no backdrop: the page behind
 * stays visible, unchanged and usable.
 */
export function MenuPanel({ anchor, label, sections, focusOn = "first", align = "start", onClose, onSwitch }: MenuPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const items = sections.flatMap((s) => s.items);
  const [active, setActive] = useState(focusOn === "last" ? Math.max(items.length - 1, 0) : 0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const baseId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Positioned from the trigger once the panel has a size to measure, and kept
  // inside the viewport. Hidden (not unmounted) until then, so it never flashes
  // in the wrong place.
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const p = panelRef.current?.getBoundingClientRect();
    if (!p) return;
    const left = align === "end" ? a.right - p.width : a.left;
    setPos({
      left: Math.max(8, Math.min(left, window.innerWidth - p.width - 8)),
      top: Math.max(8, Math.min(a.bottom + 4, window.innerHeight - p.height - 8)),
    });
  }, [anchor, align]);

  useEffect(() => {
    if (pos) itemRefs.current[active]?.focus({ preventScroll: true });
  }, [active, pos]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !anchor.contains(target)) closeRef.current(false);
    }
    function onScroll(e: Event) {
      // Scrolling the list itself is fine; the page moving out from under it is not.
      if (!panelRef.current?.contains(e.target as Node)) closeRef.current(false);
    }
    const onResize = () => closeRef.current(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [anchor]);

  function move(to: number) {
    if (items.length === 0) return;
    setActive((to + items.length) % items.length);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(active + 1);
        return;
      case "ArrowUp":
        e.preventDefault();
        move(active - 1);
        return;
      case "Home":
        e.preventDefault();
        move(0);
        return;
      case "End":
        e.preventDefault();
        move(items.length - 1);
        return;
      case "ArrowRight":
      case "ArrowLeft":
        if (onSwitch) {
          e.preventDefault();
          onSwitch(e.key === "ArrowRight" ? 1 : -1);
        }
        return;
      case "Escape":
        e.preventDefault();
        onClose(true);
        return;
      case "Tab":
        // Not prevented: focus goes back to the trigger first, so Tab then moves
        // on from there - the menu never holds focus hostage.
        onClose(true);
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          const ch = e.key.toLowerCase();
          for (let step = 1; step <= items.length; step++) {
            const i = (active + step) % items.length;
            if (items[i].label.toLowerCase().startsWith(ch)) {
              setActive(i);
              return;
            }
          }
        }
    }
  }

  function choose(item: MenuItemDef) {
    // A disabled item does nothing - the click is the answer to "why not?", and
    // that is already on screen (tooltip) and in the accessibility tree.
    if (item.disabledReason) return;
    onClose(true);
    item.onSelect?.(anchor);
  }

  // Where each section's first item sits in the flat list (the roving focus index).
  const starts = sections.map((_, si) => sections.slice(0, si).reduce((n, sec) => n + sec.items.length, 0));
  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      className="ae-mb-menu no-print"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? undefined : "hidden" }}
      onKeyDown={onKeyDown}
    >
      {sections.map((section, si) => {
        const headingId = `${baseId}-h${si}`;
        const rows = section.items.map((item, k) => {
          const i = starts[si] + k;
          const disabled = !!item.disabledReason;
          const radio = item.checked !== undefined;
          return (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role={radio ? "menuitemradio" : "menuitem"}
              aria-checked={radio ? item.checked : undefined}
              aria-disabled={disabled || undefined}
              aria-describedby={disabled ? `${baseId}-d-${item.id}` : undefined}
              aria-keyshortcuts={item.shortcut ? ariaShortcut(item.shortcut) : undefined}
              tabIndex={i === active ? 0 : -1}
              title={item.disabledReason}
              className={`ae-mb-item${item.tone === "danger" ? " ae-mb-item--danger" : ""}${disabled ? " ae-mb-item--disabled" : ""}${i === active ? " ae-mb-item--active" : ""}`}
              onClick={() => choose(item)}
              onMouseMove={() => active !== i && setActive(i)}
            >
              <span className="ae-mb-item-icon" aria-hidden>
                {radio ? item.checked ? <CheckIcon /> : null : item.icon}
              </span>
              <span className="ae-mb-item-label">{item.label}</span>
              {item.shortcut && !disabled && <kbd className="ae-mb-shortcut">{item.shortcut}</kbd>}
              {disabled && (
                <span className="ae-mb-item-flag" aria-hidden>
                  <BanIcon />
                </span>
              )}
              {disabled && (
                <span id={`${baseId}-d-${item.id}`} hidden>
                  {item.disabledReason}
                </span>
              )}
            </button>
          );
        });
        return (
          <Fragment key={si}>
            {si > 0 && <div role="separator" className="ae-mb-sep" />}
            {section.heading ? (
              <div role="group" aria-labelledby={headingId}>
                <div id={headingId} className="ae-mb-heading">
                  {section.heading}
                </div>
                {rows}
              </div>
            ) : (
              rows
            )}
          </Fragment>
        );
      })}
    </div>,
    document.body,
  );
}

/**
 * A menu bar: text menus ("Edit", "View", ...) holding the less frequent actions,
 * with the keyboard behaviour of a desktop application.
 *
 * Focus: the bar is ONE tab stop (roving tabindex). Left/Right move between
 * menus, Down/Enter/Space open one, Up opens it at the last item, Home/End jump
 * to the first/last menu. While a menu is open, Left/Right and hovering another
 * menu switch to it. A menu opens on click, closes on Esc (focus returns to its
 * trigger) or an outside click, and never traps focus.
 */
export function MenuBar({ label, menus, className = "" }: { label: string; menus: MenuDef[]; className?: string }) {
  // Which menu is open, where it hangs from (captured when it is opened, in an
  // event handler - never read from a ref while rendering) and which item gets
  // focus first.
  const [openState, setOpenState] = useState<{ id: string; anchor: HTMLElement; focusOn: FocusOn } | null>(null);
  const openId = openState?.id ?? null;
  // The one trigger that is in the tab order.
  const [stopId, setStopId] = useState<string | null>(menus[0]?.id ?? null);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const baseId = useId();
  const ids = menus.map((m) => m.id);
  const tabStop = stopId && ids.includes(stopId) ? stopId : ids[0];

  function open(id: string, from: FocusOn = "first") {
    const anchor = triggers.current[id];
    if (!anchor) return;
    setStopId(id);
    setOpenState({ id, anchor, focusOn: from });
  }

  function close(restoreFocus: boolean) {
    const id = openId;
    setOpenState(null);
    if (restoreFocus && id) triggers.current[id]?.focus();
  }

  function step(from: string, direction: -1 | 1, thenOpen: boolean) {
    const next = ids[(ids.indexOf(from) + direction + ids.length) % ids.length];
    if (thenOpen) open(next);
    else {
      setStopId(next);
      triggers.current[next]?.focus();
    }
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>, id: string) {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowLeft":
        e.preventDefault();
        step(id, e.key === "ArrowRight" ? 1 : -1, openId !== null);
        return;
      case "ArrowDown":
        e.preventDefault();
        open(id, "first");
        return;
      case "ArrowUp":
        e.preventDefault();
        open(id, "last");
        return;
      case "Home":
      case "End": {
        e.preventDefault();
        const target = e.key === "Home" ? ids[0] : ids[ids.length - 1];
        setStopId(target);
        triggers.current[target]?.focus();
        return;
      }
      case "Escape":
        if (openId) {
          e.preventDefault();
          close(true);
        }
    }
  }

  const openMenu = menus.find((m) => m.id === openId);

  return (
    <div role="menubar" aria-label={label} className={`ae-mb-bar ${className}`.trim()}>
      {menus.map((menu) => {
        const isOpen = openId === menu.id;
        return (
          <button
            key={menu.id}
            ref={(el) => {
              triggers.current[menu.id] = el;
            }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-controls={isOpen ? `${baseId}-panel` : undefined}
            aria-label={menu.icon ? menu.label : undefined}
            title={menu.icon ? menu.label : undefined}
            tabIndex={menu.id === tabStop ? 0 : -1}
            className={`ae-mb-trigger${isOpen ? " ae-mb-trigger--open" : ""}${menu.icon ? " ae-mb-trigger--icon" : ""}`}
            onClick={() => (isOpen ? close(true) : open(menu.id))}
            onKeyDown={(e) => onTriggerKeyDown(e, menu.id)}
            // Hovering another menu while one is open switches to it, as in a
            // desktop menu bar; with none open, hovering does nothing.
            onMouseEnter={() => openId && openId !== menu.id && open(menu.id)}
          >
            {menu.icon ?? (
              <>
                <span>{menu.label}</span>
                <ChevronIcon />
              </>
            )}
          </button>
        );
      })}
      {openMenu && openState && (
        <MenuPanel
          key={openMenu.id}
          anchor={openState.anchor}
          label={openMenu.label}
          sections={openMenu.sections}
          focusOn={openState.focusOn}
          align={openMenu.icon ? "end" : "start"}
          onClose={close}
          onSwitch={(direction) => step(openMenu.id, direction, true)}
        />
      )}
    </div>
  );
}
