import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { formatDateDisplay } from "../utils/dateFormat";

/**
 * Themed replacement for `<input type="date">`.
 *
 * The browser's native calendar popup can't be styled at all (it ignores the
 * light/dark theme and the brand palette), so the date fields render this
 * instead: a trigger that looks like every other .ae-input, and a calendar
 * dialog anchored underneath it. Styling lives in the .ae-date-trigger /
 * .ae-datepicker rules in index.css.
 *
 * `value` / `onChange` use the same "YYYY-MM-DD" strings the native input
 * did, but `onChange` receives the string directly (not a change event).
 *
 * Keyboard: arrows move by day/week, Home/End jump to the week's start/end,
 * PageUp/PageDown change month (Shift = year), Enter/Space picks, Esc closes.
 */

const PANEL_WIDTH = 296;
const PANEL_HEIGHT = 372; // days view incl. header + footer - only used to decide whether to open upward

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: "long" }));
const MONTH_SHORT_NAMES = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: "short" }));
// 2023-01-01 was a Sunday, so index 0 is Sunday.
const WEEKDAY_NAMES = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" }));

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Built from the parts (never `new Date("YYYY-MM-DD")`, which is UTC midnight
// and shows the previous day in timezones behind UTC) - same reason as
// utils/dateFormat.ts.
function parseISO(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/// Clamps the day so Jan 31 + 1 month is Feb 28/29, not a spill into March.
function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay));
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface DatePickerProps {
  /// "YYYY-MM-DD", or "" for no date yet.
  value: string;
  onChange: (value: string) => void;
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  /// What the "Today" button (and the today ring) mean, as "YYYY-MM-DD".
  /// Defaults to the calendar date. Shift-based pages pass the current
  /// *business* date instead (see getCurrentShiftAndDate) - just after
  /// midnight that's still yesterday's Night shift, and jumping to the new
  /// calendar day would start a second, near-empty record.
  todayValue?: string;
}

type Position = { left: number; width: number; top?: number; bottom?: number };

export function DatePicker({ value, onChange, className = "", style, disabled, todayValue, "aria-label": ariaLabel }: DatePickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusDayRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"days" | "months">("days");
  const [pos, setPos] = useState<Position | null>(null);

  const selected = parseISO(value);
  const today = (todayValue ? parseISO(todayValue) : null) ?? new Date();
  // The one date that is both "where the keyboard is" and which month is showing.
  const [focus, setFocus] = useState<Date>(selected ?? today);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(PANEL_WIDTH, vw - 16);
    const left = Math.max(8, Math.min(rect.left, vw - width - 8));
    const spaceBelow = vh - rect.bottom - 8;
    const openUp = spaceBelow < PANEL_HEIGHT && rect.top - 8 > spaceBelow;
    setPos(openUp ? { left, width, bottom: vh - rect.top + 6 } : { left, width, top: rect.bottom + 6 });
  }, []);

  function openPicker() {
    if (disabled) return;
    setFocus(selected ?? today);
    setView("days");
    focusDayRef.current = true;
    updatePosition();
    setOpen(true);
  }

  function closePicker(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function pick(date: Date) {
    onChange(toISO(date));
    closePicker();
  }

  // Keep the dialog glued to its trigger while the page scrolls/resizes
  // (the toolbar can scroll sideways, the sidebar can collapse, ...).
  useLayoutEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  // Click outside closes it (without stealing focus back from wherever the
  // user just clicked).
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

  // Move real DOM focus onto the active day/month - but only when the change
  // came from opening / the keyboard, so clicking the month arrows with the
  // mouse doesn't yank focus off the arrow.
  useEffect(() => {
    if (!open || !focusDayRef.current) return;
    focusDayRef.current = false;
    panelRef.current?.querySelector<HTMLElement>('[data-focus-target="true"]')?.focus();
  }, [open, focus, view]);

  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      // Stop here so an enclosing Modal's own Escape handler doesn't also fire.
      e.stopPropagation();
      e.preventDefault();
      closePicker();
      return;
    }
    if (e.key === "Tab" && panelRef.current) {
      // Small focus trap: it's a dialog, so Tab cycles inside it.
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"])'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    let next: Date;
    switch (e.key) {
      case "ArrowLeft":
        next = addDays(focus, -1);
        break;
      case "ArrowRight":
        next = addDays(focus, 1);
        break;
      case "ArrowUp":
        next = addDays(focus, -7);
        break;
      case "ArrowDown":
        next = addDays(focus, 7);
        break;
      case "Home":
        next = addDays(focus, -focus.getDay());
        break;
      case "End":
        next = addDays(focus, 6 - focus.getDay());
        break;
      case "PageUp":
        next = addMonths(focus, e.shiftKey ? -12 : -1);
        break;
      case "PageDown":
        next = addMonths(focus, e.shiftKey ? 12 : 1);
        break;
      default:
        return;
    }
    e.preventDefault();
    focusDayRef.current = true;
    setFocus(next);
  }

  function toggleView() {
    focusDayRef.current = true;
    setView((v) => (v === "days" ? "months" : "days"));
  }

  function shift(delta: number) {
    // Days view steps months, months view steps years.
    setFocus((f) => addMonths(f, view === "days" ? delta : delta * 12));
  }

  function pickMonth(monthIndex: number) {
    const lastDay = new Date(focus.getFullYear(), monthIndex + 1, 0).getDate();
    focusDayRef.current = true;
    setFocus(new Date(focus.getFullYear(), monthIndex, Math.min(focus.getDate(), lastDay)));
    setView("days");
  }

  // 6 full weeks, always - a constant height so the dialog never jumps
  // between 5- and 6-row months.
  const firstOfMonth = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  const longLabel = selected ? selected.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Select date";
  const shortLabel = selected ? selected.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" }) : "Select";
  const dialogLabel = ariaLabel ? `Choose ${ariaLabel.toLowerCase()}` : "Choose date";

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`ae-input ae-date-trigger ${className}`.trim()}
        style={style}
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel}: ${selected ? formatDateDisplay(value) : "not set"}` : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? closePicker() : openPicker())}
      >
        <span className="ae-date-trigger-text ae-date-long">{longLabel}</span>
        <span className="ae-date-trigger-text ae-date-short">{shortLabel}</span>
        <span className="ae-date-trigger-icon" aria-hidden>
          <CalendarIcon />
        </span>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              key="datepicker"
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={dialogLabel}
              tabIndex={-1}
              className="ae-datepicker no-print"
              style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
              initial={{ opacity: 0, y: pos.bottom !== undefined ? 6 : -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.08 } }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              // React events from a portal still bubble to the portal's React
              // ancestors: a click would hit an enclosing Modal's
              // click-outside-to-close, and mouse-move would drag the
              // Toolbar's cursor glow around while hovering the calendar.
              onClick={(e) => e.stopPropagation()}
              onMouseMove={(e) => e.stopPropagation()}
              onKeyDown={onPanelKeyDown}
            >
              <div className="ae-datepicker-head">
                <button type="button" className="ae-datepicker-nav" aria-label={view === "days" ? "Previous month" : "Previous year"} onClick={() => shift(-1)}>
                  <ChevronLeftIcon />
                </button>
                <button
                  type="button"
                  className="ae-datepicker-title"
                  aria-live="polite"
                  aria-label={view === "days" ? "Choose month and year" : "Back to days"}
                  onClick={toggleView}
                >
                  {view === "days" ? `${MONTH_NAMES[focus.getMonth()]} ${focus.getFullYear()}` : focus.getFullYear()}
                </button>
                <button type="button" className="ae-datepicker-nav" aria-label={view === "days" ? "Next month" : "Next year"} onClick={() => shift(1)}>
                  <ChevronRightIcon />
                </button>
              </div>

              <div className="ae-datepicker-body">
                {view === "days" ? (
                  <>
                    <div className="ae-datepicker-weekdays" aria-hidden>
                      {WEEKDAY_NAMES.map((w) => (
                        <div key={w} className="ae-datepicker-weekday">
                          {w}
                        </div>
                      ))}
                    </div>
                    <div className="ae-datepicker-grid" role="group" aria-label={`${MONTH_NAMES[focus.getMonth()]} ${focus.getFullYear()}`} onKeyDown={onGridKeyDown}>
                      {cells.map((day) => {
                        const outside = day.getMonth() !== focus.getMonth();
                        const isSelected = selected !== null && sameDay(day, selected);
                        const isToday = sameDay(day, today);
                        const isFocus = sameDay(day, focus);
                        const classes = ["ae-datepicker-day", outside && "ae-datepicker-day--outside", isToday && "ae-datepicker-day--today", isSelected && "ae-datepicker-day--selected"]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <button
                            key={toISO(day)}
                            type="button"
                            className={classes}
                            tabIndex={isFocus ? 0 : -1}
                            data-focus-target={isFocus ? "true" : undefined}
                            aria-label={formatDateDisplay(toISO(day))}
                            aria-pressed={isSelected}
                            aria-current={isToday ? "date" : undefined}
                            onClick={() => pick(day)}
                          >
                            {day.getDate()}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="ae-datepicker-months">
                    {MONTH_SHORT_NAMES.map((name, i) => {
                      const isFocusMonth = i === focus.getMonth();
                      const isSelectedMonth = selected !== null && selected.getFullYear() === focus.getFullYear() && selected.getMonth() === i;
                      return (
                        <button
                          key={name}
                          type="button"
                          className={`ae-datepicker-month${isSelectedMonth ? " ae-datepicker-month--selected" : ""}`}
                          data-focus-target={isFocusMonth ? "true" : undefined}
                          aria-label={`${MONTH_NAMES[i]} ${focus.getFullYear()}`}
                          onClick={() => pickMonth(i)}
                        >
                          {name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="ae-datepicker-foot">
                <span className="ae-datepicker-foot-text">{selected ? formatDateDisplay(value) : "No date selected"}</span>
                <button type="button" className="ae-datepicker-today" onClick={() => pick(today)}>
                  Today
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}