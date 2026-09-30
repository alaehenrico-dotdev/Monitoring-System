import { motion, useReducedMotion } from "motion/react";
import { createPortal } from "react-dom";
import { colors } from "../theme";

const SIZES = { sm: 16, md: 24, lg: 36 } as const;

export function Spinner({
  size = "md",
  color = colors.yellow,
  percent,
}: {
  size?: keyof typeof SIZES | number;
  color?: string;
  /// When given (0-100), renders a determinate ring showing that real
  /// share of work done, with the number in the center, instead of the
  /// plain indeterminate spin below. Pass this wherever real per-item
  /// progress already exists (see LoadingOverlay during a multi-row Save)
  /// so the one animation on screen actually reports progress rather than
  /// just "something is happening" - same "no fake looping progress" rule
  /// the top progress bar follows (hooks/useTopProgress.tsx).
  percent?: number;
}) {
  const px = typeof size === "number" ? size : SIZES[size];
  // Framer Motion's `animate`/`repeat` don't honor prefers-reduced-motion on
  // their own (unlike the plain-CSS shimmer/pulse elsewhere in the loading
  // system) - `useReducedMotion` reads the OS setting directly so a
  // continuously-spinning ring doesn't run for someone who's asked their
  // system to minimize motion. A static ring still reads as "busy" (the
  // gap in its border) without ever actually moving.
  const reducedMotion = useReducedMotion();

  if (percent !== undefined) {
    const clamped = Math.min(100, Math.max(0, percent));
    const stroke = Math.max(2, Math.round(px / 8));
    const radius = (px - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    return (
      <span
        role="status"
        aria-live="polite"
        style={{
          position: "relative",
          display: "inline-flex",
          width: px,
          height: px,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width={px}
          height={px}
          style={{ transform: "rotate(-90deg)" }}
          aria-hidden
        >
          <circle
            cx={px / 2}
            cy={px / 2}
            r={radius}
            fill="none"
            stroke={`color-mix(in srgb, ${color} 25%, transparent)`}
            strokeWidth={stroke}
          />
          <circle
            cx={px / 2}
            cy={px / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - clamped / 100)}
            style={{
              transition: reducedMotion
                ? undefined
                : "stroke-dashoffset 150ms linear",
            }}
          />
        </svg>
        <span
          aria-hidden
          style={{
            position: "absolute",
            fontSize: Math.max(9, Math.round(px / 3.2)),
            fontWeight: 700,
            color,
          }}
        >
          {Math.round(clamped)}%
        </span>
      </span>
    );
  }

  return (
    <motion.span
      aria-hidden
      animate={reducedMotion ? undefined : { rotate: 360 }}
      transition={
        reducedMotion
          ? undefined
          : { repeat: Infinity, duration: 0.8, ease: "linear" }
      }
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
export function InlineLoading({
  label = "Loading…",
  size = "sm",
}: {
  label?: string;
  size?: keyof typeof SIZES | number;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        color: colors.subtleInk,
        fontSize: 13,
      }}
    >
      <Spinner size={size} />
      {label}
    </span>
  );
}

/// Full-screen dimmed backdrop + centered spinner - the unmissable "actively
/// saving, don't touch anything" signal for an action already in progress
/// (unlike LoadingBlock/InlineLoading above, which mark a section that's
/// still waiting on its first fetch). Complements useTopProgress's thin
/// top-of-viewport bar rather than replacing it: that bar reports real
/// per-item progress: this is purely the center-of-screen "something is
/// happening" cue. Styled after Modal.tsx's own overlay (fixed/inset:0,
/// same dim background) but with no bordered dialog panel, and portaled to
/// document.body the same way, for the same stacking-context reasons - with
/// a higher z-index (300 vs Modal's 200) since Save can still be in flight
/// while the dialog that triggered it (e.g. "Unsaved changes") is still
/// open underneath.
export function LoadingOverlay({
  label = "Saving…",
  percent,
}: {
  label?: string;
  percent?: number;
}) {
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "rgba(12, 12, 12, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Spinner size="lg" percent={percent} />
        <span style={{ color: colors.cream, fontSize: 14, fontWeight: 600 }}>
          {label}
        </span>
      </div>
    </div>,
    document.body,
  );
}
