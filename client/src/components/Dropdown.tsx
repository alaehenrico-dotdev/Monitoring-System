import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronIcon } from "./icons";

/**
 * Themed replacement for a bare `<select>` (see `Select` in ui.tsx).
 *
 * Same trigger-plus-portaled-panel shape as DatePicker: the browser's native
 * `<select>` popup can't be restyled (system font, square corners, ignores
 * the dark/paper theme), so toolbar dropdowns render this instead - a
 * trigger that looks like every other .ae-input, and an option list
 * anchored underneath it. Styling lives in the .ae-select-trigger /
 * .ae-dropdown rules in index.css, mirroring .ae-date-trigger /
 * .ae-datepicker.
 *
 * Keyboard: Up/Down/Home/End move the highlighted option, Enter/Space picks
 * it, Esc closes. Typing jumps to the next option starting with that letter
 * (repeat the same letter to cycle through matches), same as a native
 * <select>.
 */

const PANEL_MIN_WIDTH = 160;
const PANEL_MAX_WIDTH = 320;
const PANEL_MAX_HEIGHT = 280;
const TYPEAHEAD_RESET_MS = 700;

export interface DropdownOption {
  value: string;
  label: string;
  /// Full text shown as a hover tooltip - lets an option carry a longer
  /// description than the label that's shown in the (possibly narrow,
  /// toolbar-compact-tier) trigger and list, mirroring ShiftFilter's old
  /// per-option `title`.
  title?: string;
}

interface DropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  /// Shown on the trigger when `value` matches no option (e.g. "0" for an
  /// unset SKU picker).
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  /// Hover tooltip for the trigger itself. Defaults to the selected
  /// option's own `title`.
  title?: string;
}

type Position = { left: number; minWidth: number; top?: number; bottom?: number };

export function Dropdown({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className = "",
  style,
  disabled,
  title,
  "aria-label": ariaLabel,
}: DropdownProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef(false);
  const typeaheadRef = useRef<{ text: string; timer: ReturnType<typeof setTimeout> | null }>({ text: "", timer: null });

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex));
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minWidth = Math.min(Math.max(rect.width, PANEL_MIN_WIDTH), vw - 16);
    const left = Math.max(8, Math.min(rect.left, vw - minWidth - 8));
    const spaceBelow = vh - rect.bottom - 8;
    const openUp = spaceBelow < PANEL_MAX_HEIGHT && rect.top - 8 > spaceBelow;
    setPos(openUp ? { left, minWidth, bottom: vh - rect.top + 6 } : { left, minWidth, top: rect.bottom + 6 });
  }, []);

  function openMenu() {
    if (disabled || options.length === 0) return;
    setActiveIndex(Math.max(0, selectedIndex));
    focusRef.current = true;
    updatePosition();
    setOpen(true);
  }

  function closeMenu(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function pick(index: number) {
    const opt = options[index];
    if (!opt) return;
    if (opt.value !== value) onChange(opt.value);
    closeMenu();
  }

  // Keep the panel glued to its trigger while the page scrolls/resizes -
  // same reasoning as DatePicker (toolbar can scroll sideways, sidebar can
  // collapse, ...).
  useLayoutEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Move real DOM focus onto the highlighted option - only when the change
  // came from opening / the keyboard (see DatePicker's identical pattern),
  // so hovering an option with the mouse doesn't yank focus off the trigger.
  useEffect(() => {
    if (!open || !focusRef.current) return;
    focusRef.current = false;
    listRef.current?.querySelector<HTMLElement>('[data-focus-target="true"]')?.scrollIntoView({ block: "nearest" });
    listRef.current?.querySelector<HTMLElement>('[data-focus-target="true"]')?.focus();
  }, [open, activeIndex]);

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu();
    }
  }

  function typeahead(key: string) {
    const state = typeaheadRef.current;
    if (state.timer) clearTimeout(state.timer);
    const text = (state.text.length === 1 && state.text === key ? "" : state.text) + key.toLowerCase();
    state.text = text;
    state.timer = setTimeout(() => {
      typeaheadRef.current.text = "";
    }, TYPEAHEAD_RESET_MS);

    const n = options.length;
    for (let step = 1; step <= n; step++) {
      const i = (activeIndex + step) % n;
      if (options[i].label.toLowerCase().startsWith(text)) {
        focusRef.current = true;
        setActiveIndex(i);
        return;
      }
    }
  }

  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      // Stop here so an enclosing Modal's own Escape handler doesn't also fire.
      e.stopPropagation();
      e.preventDefault();
      closeMenu();
      return;
    }
    if (e.key === "Tab") {
      // Single-purpose menu, not a focus trap: Tab just closes it, like a
      // click-away would.
      closeMenu(false);
      return;
    }
    let next: number;
    switch (e.key) {
      case "ArrowDown":
        next = Math.min(options.length - 1, activeIndex + 1);
        break;
      case "ArrowUp":
        next = Math.max(0, activeIndex - 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = options.length - 1;
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(activeIndex);
        return;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          e.preventDefault();
          typeahead(e.key);
        }
        return;
    }
    e.preventDefault();
    focusRef.current = true;
    setActiveIndex(next);
  }

  const triggerLabel = selected ? selected.label : placeholder;
  const dialogLabel = ariaLabel ? `Choose ${ariaLabel.toLowerCase()}` : "Choose option";

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`ae-input ae-select-trigger ${className}`.trim()}
        style={style}
        disabled={disabled}
        title={title ?? selected?.title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="ae-select-trigger-text">{triggerLabel}</span>
        <span className="ae-select-trigger-icon" aria-hidden>
          <ChevronIcon />
        </span>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              key="dropdown"
              ref={panelRef}
              role="listbox"
              aria-label={dialogLabel}
              tabIndex={-1}
              className="ae-dropdown no-print"
              style={{ left: pos.left, minWidth: pos.minWidth, maxWidth: PANEL_MAX_WIDTH, top: pos.top, bottom: pos.bottom }}
              initial={{ opacity: 0, y: pos.bottom !== undefined ? 6 : -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.08 } }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              // React events from a portal still bubble to the portal's React
              // ancestors - a click would hit an enclosing Modal's
              // click-outside-to-close, and mouse-move would drag the
              // Toolbar's cursor glow around while hovering the list.
              onClick={(e) => e.stopPropagation()}
              onMouseMove={(e) => e.stopPropagation()}
              onKeyDown={onPanelKeyDown}
            >
              <div className="ae-dropdown-list" ref={listRef} role="presentation">
                {options.map((opt, i) => {
                  const isSelected = opt.value === value;
                  const isActive = i === activeIndex;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`ae-dropdown-option${isSelected ? " ae-dropdown-option--selected" : ""}`}
                      tabIndex={isActive ? 0 : -1}
                      data-focus-target={isActive ? "true" : undefined}
                      title={opt.title}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => pick(i)}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
