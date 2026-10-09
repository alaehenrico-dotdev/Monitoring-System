import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { addDays, addMonths, parseISO, rangeLabels, sameDay, toISO } from "../utils/calendar";

/**
 * One field for a date range: a single trigger ("Oct 1 – Oct 9, 2026") that
 * opens one calendar. The first click picks the start, the second the end
 * (in either order); presets cover the common cases. Replaces a pair of
 * DatePickers where a toolbar has no room for two fields.
 *
 * Shares the .ae-date-trigger / .ae-datepicker styling with DatePicker.
 * `from` / `to` are "YYYY-MM-DD" strings, "" for open-ended.
 */

const PANEL_WIDTH = 296;
const PANEL_HEIGHT = 420;

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: "long" }));
// 2023-01-01 was a Sunday, so index 0 is Sunday.
const WEEKDAY_NAMES = Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" }));

interface Props {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
}

type Position = { left: number; width: number; top?: number; bottom?: number };

export function DateRangePicker({ from, to, onChange, className = "", style, "aria-label": ariaLabel = "Date range" }: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusDayRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  // The start the user has just clicked, while they choose the end.
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [hover, setHover] = useState<Date | null>(null);

  const start = parseISO(from);
  const end = parseISO(to);
  const today = new Date();
  const [focus, setFocus] = useState<Date>(start ?? today);

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
    setFocus(start ?? today);
    setAnchor(null);
    setHover(null);
    focusDayRef.current = true;
    updatePosition();
    setOpen(true);
  }

  function closePicker(returnFocus = true) {
    setOpen(false);
    setAnchor(null);
    setHover(null);
    if (returnFocus) triggerRef.current?.focus();
  }

  function apply(a: Date | null, b: Date | null) {
    onChange(a ? toISO(a) : "", b ? toISO(b) : "");
  }

  function pickDay(day: Date) {
    if (!anchor) {
      // The range is already usable as a single day; a second click extends it.
      setAnchor(day);
      apply(day, day);
      return;
    }
    const [lo, hi] = day < anchor ? [day, anchor] : [anchor, day];
    apply(lo, hi);
    closePicker();
  }

  function preset(a: Date | null, b: Date | null) {
    apply(a, b);
    closePicker();
  }

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
      setAnchor(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || !focusDayRef.current) return;
    focusDayRef.current = false;
    panelRef.current?.querySelector<HTMLElement>('[data-focus-target="true"]')?.focus();
  }, [open, focus]);

  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      closePicker();
      return;
    }
    if (e.key === "Tab" && panelRef.current) {
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
    const next =
      e.key === "ArrowLeft" ? addDays(focus, -1)
      : e.key === "ArrowRight" ? addDays(focus, 1)
      : e.key === "ArrowUp" ? addDays(focus, -7)
      : e.key === "ArrowDown" ? addDays(focus, 7)
      : e.key === "Home" ? addDays(focus, -focus.getDay())
      : e.key === "End" ? addDays(focus, 6 - focus.getDay())
      : e.key === "PageUp" ? addMonths(focus, e.shiftKey ? -12 : -1)
      : e.key === "PageDown" ? addMonths(focus, e.shiftKey ? 12 : 1)
      : null;
    if (!next) return;
    e.preventDefault();
    focusDayRef.current = true;
    // While choosing the end, the keyboard focus previews the range like hover.
    if (anchor) setHover(next);
    setFocus(next);
  }

  const firstOfMonth = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  // What the calendar shades: the live preview while picking the end, else the applied range.
  const [lo, hi] =
    anchor && hover ? (hover < anchor ? [hover, anchor] : [anchor, hover]) : anchor ? [anchor, anchor] : [start, end ?? start];

  const labels = rangeLabels(from, to);
  const monthLabel = `${MONTH_NAMES[focus.getMonth()]} ${focus.getFullYear()}`;
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`ae-input ae-date-trigger ae-date-range-trigger ${className}`.trim()}
        style={style}
        aria-label={`${ariaLabel}: ${labels.long}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? closePicker() : openPicker())}
      >
        <span className="ae-date-trigger-text ae-date-long">{labels.long}</span>
        <span className="ae-date-trigger-text ae-date-short">{labels.short}</span>
        <span className="ae-date-trigger-icon" aria-hidden>
          <CalendarIcon />
        </span>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              key="daterangepicker"
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={`Choose ${ariaLabel.toLowerCase()}`}
              tabIndex={-1}
              className="ae-datepicker no-print"
              style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
              initial={{ opacity: 0, y: pos.bottom !== undefined ? 6 : -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.08 } }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
              onMouseMove={(e) => e.stopPropagation()}
              onKeyDown={onPanelKeyDown}
            >
              <div className="ae-datepicker-presets">
                <button type="button" className="ae-datepicker-today" onClick={() => preset(today, today)}>
                  Today
                </button>
                <button type="button" className="ae-datepicker-today" onClick={() => preset(addDays(today, -6), today)}>
                  Last 7 days
                </button>
                <button type="button" className="ae-datepicker-today" onClick={() => preset(monthStart, today)}>
                  This month
                </button>
                <button type="button" className="ae-datepicker-today" onClick={() => preset(null, null)}>
                  Any date
                </button>
              </div>

              <div className="ae-datepicker-head">
                <button type="button" className="ae-datepicker-nav" aria-label="Previous month" onClick={() => setFocus((f) => addMonths(f, -1))}>
                  <ChevronLeftIcon />
                </button>
                <span className="ae-datepicker-title" aria-live="polite">
                  {monthLabel}
                </span>
                <button type="button" className="ae-datepicker-nav" aria-label="Next month" onClick={() => setFocus((f) => addMonths(f, 1))}>
                  <ChevronRightIcon />
                </button>
              </div>

              <div className="ae-datepicker-body">
                <div className="ae-datepicker-weekdays" aria-hidden>
                  {WEEKDAY_NAMES.map((w) => (
                    <div key={w} className="ae-datepicker-weekday">
                      {w}
                    </div>
                  ))}
                </div>
                <div className="ae-datepicker-grid" role="group" aria-label={monthLabel} onKeyDown={onGridKeyDown} onMouseLeave={() => setHover(null)}>
                  {cells.map((day) => {
                    const outside = day.getMonth() !== focus.getMonth();
                    const isEdge = (lo !== null && sameDay(day, lo)) || (hi !== null && sameDay(day, hi));
                    const inRange = lo !== null && hi !== null && day > lo && day < hi;
                    const isFocus = sameDay(day, focus);
                    const classes = [
                      "ae-datepicker-day",
                      outside && "ae-datepicker-day--outside",
                      sameDay(day, today) && "ae-datepicker-day--today",
                      isEdge && "ae-datepicker-day--selected",
                      inRange && "ae-datepicker-day--inrange",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <button
                        key={toISO(day)}
                        type="button"
                        className={classes}
                        tabIndex={isFocus ? 0 : -1}
                        data-focus-target={isFocus ? "true" : undefined}
                        aria-label={day.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
                        aria-pressed={isEdge || inRange}
                        onMouseEnter={() => anchor && setHover(day)}
                        onClick={() => pickDay(day)}
                      >
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="ae-datepicker-foot">
                <span className="ae-datepicker-foot-text">{anchor ? "Pick the end date" : "Pick a start, then an end"}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
