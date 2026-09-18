import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, KeyboardEvent, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { motion } from "motion/react";
import { colors } from "../theme";
import { toolbarLayoutTransition } from "../motion";

/**
 * Shared form controls. Every text field, date field, select, and button in
 * the app should render through these instead of a bare <input>/<select>/
 * <button> with its own one-off inline style - that's what let the date
 * pickers, location fields, and buttons drift out of sync with each other
 * across pages. Styling itself lives in the .ae-* classes in index.css so
 * focus/hover states (which inline styles can't express) stay centralized too.
 */

export function TextInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ae-input ${className}`.trim()} {...rest} />;
}

interface NumberCellInputProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  step?: number;
  className?: string;
  style?: CSSProperties;
  "data-cell"?: string;
}

/**
 * A grid-cell number input (.ae-input-cell) with its own up/down stepper
 * instead of the browser's native one. The native spin buttons are hidden
 * in CSS (see .ae-number-cell in index.css) because their scroll-wheel/
 * ArrowUp/ArrowDown stepping fights with the grid's own arrow-key row
 * navigation (StockGrid's handleKeyDown moves between cells on those keys),
 * and their unthemed OS styling stands out against the dark cell fill.
 * These replacement buttons only ever run onChange - never onBlur's commit
 * directly - so a click steps the draft value exactly like typing would.
 */
export function NumberCellInput({ value, onChange, onBlur, onKeyDown, step = 1, className = "", style, ...rest }: NumberCellInputProps) {
  function stepBy(delta: number) {
    onChange(String((Number(value) || 0) + delta));
  }
  return (
    <span className="ae-number-cell" style={style}>
      <input
        className={`ae-input ae-input-cell ${className}`.trim()}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        {...rest}
      />
      <span className="ae-number-cell-spin">
        {/* mousedown keeps focus on the input (rather than the button) so clicking never fires the input's own onBlur commit first */}
        <button type="button" tabIndex={-1} aria-label="Increase" className="ae-number-cell-spin-up" onMouseDown={(e) => e.preventDefault()} onClick={() => stepBy(step)} />
        <button type="button" tabIndex={-1} aria-label="Decrease" className="ae-number-cell-spin-down" onMouseDown={(e) => e.preventDefault()} onClick={() => stepBy(-step)} />
      </span>
    </span>
  );
}

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`ae-select ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}

// Omits the handful of event props (drag/animation lifecycle) where React's
// own DOM event type and Framer Motion's gesture/animation-definition type
// of the same name conflict - no caller here ever passes these anyway.
interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onAnimationStart" | "onAnimationEnd" | "onDrag" | "onDragEnd" | "onDragStart"> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
}

/// `motion.button` with `layout` - most callers render this inside a
/// Toolbar (Section: toolbar), where the Save/PDF/Undo buttons resize
/// (e.g. "Save (3)" collapsing to a bare icon circle in compact mode, see
/// index.css's .ae-toolbar--compact rules) as a plain, un-transitioned CSS
/// class swap otherwise snaps instantly. `layout` makes any such box-size
/// change animate smoothly via Framer's FLIP projection instead - it's a
/// no-op everywhere else this button doesn't actually change size.
export function Button({ variant = "primary", size = "md", className = "", ...rest }: ButtonProps) {
  const sizeClass = size === "sm" ? "ae-btn-sm" : "";
  return (
    <motion.button
      layout
      transition={toolbarLayoutTransition}
      whileTap={{ scale: 0.94 }}
      className={`ae-btn ae-btn-${variant} ${sizeClass} ${className}`.trim()}
      {...rest}
    />
  );
}

export function Label({ children, ...rest }: LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode }) {
  return (
    <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: colors.subtleInk, fontWeight: 600 }} {...rest}>
      {children}
    </label>
  );
}

/** Label + control stacked - the "Date" / "Location" / etc. filter-bar pattern used across pages. */
export function Field({ label, children, style }: { label: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={style}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
