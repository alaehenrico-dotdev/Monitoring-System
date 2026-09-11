import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { colors } from "../theme";

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

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`ae-select ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
}

export function Button({ variant = "primary", size = "md", className = "", ...rest }: ButtonProps) {
  const sizeClass = size === "sm" ? "ae-btn-sm" : "";
  return <button className={`ae-btn ae-btn-${variant} ${sizeClass} ${className}`.trim()} {...rest} />;
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
