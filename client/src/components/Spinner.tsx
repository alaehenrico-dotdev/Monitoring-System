import { motion, useReducedMotion } from "motion/react";
import { colors } from "../theme";

const SIZES = { sm: 16, md: 24, lg: 36 } as const;

export function Spinner({ size = "md", color = colors.yellow }: { size?: keyof typeof SIZES | number; color?: string }) {
  const px = typeof size === "number" ? size : SIZES[size];
  // Framer Motion's `animate`/`repeat` don't honor prefers-reduced-motion on
  // their own (unlike the plain-CSS shimmer/pulse elsewhere in the loading
  // system) - `useReducedMotion` reads the OS setting directly so a
  // continuously-spinning ring doesn't run for someone who's asked their
  // system to minimize motion. A static ring still reads as "busy" (the
  // gap in its border) without ever actually moving.
  const reducedMotion = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      animate={reducedMotion ? undefined : { rotate: 360 }}
      transition={reducedMotion ? undefined : { repeat: Infinity, duration: 0.8, ease: "linear" }}
      style={{
        display: "inline-block",
        width: px,
        height: px,
        borderRadius: "50%",
        border: `${Math.max(2, Math.round(px / 8))}px solid color-mix(in srgb, ${color} 25%, transparent)`,
        borderTopColor: color,
        boxSizing: "border-box",
      }}
    />
  );
}

/// Centered spinner + label, dropped in wherever a page/section is waiting
/// on an async fetch (Total Stocks, Manual Count, Products, Change Log,
/// Receipts, ...) in place of a bare "Loading…" <p> - one shared look for
/// every wait state instead of each page inventing its own.
export function LoadingBlock({
  label = "Loading…",
  size = "md",
  minHeight = 120,
}: {
  label?: string;
  size?: keyof typeof SIZES | number;
  minHeight?: number | string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        minHeight,
        padding: "16px",
        color: colors.subtleInk,
        fontSize: 13,
      }}
    >
      <Spinner size={size} />
      <span>{label}</span>
    </div>
  );
}

/// Inline variant (spinner + text side by side) for tight spaces that don't
/// have room for LoadingBlock's centered column, e.g. a small card message.
export function InlineLoading({ label = "Loading…", size = "sm" }: { label?: string; size?: keyof typeof SIZES | number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: colors.subtleInk, fontSize: 13 }}>
      <Spinner size={size} />
      {label}
    </span>
  );
}
