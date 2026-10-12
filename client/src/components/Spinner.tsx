import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { colors } from "../theme";

/// The transparent-background Ala Eh! logo, used exactly as supplied (also the
/// poster frame of LogoMark's video, so it is usually already cached).
const LOGO_SRC = "/alaeh-logo-3d-poster.png";

const SIZES = { sm: 18, md: 28, lg: 44, xl: 72, xxl: 128 } as const;

/// The app's loading indicator: the logo, unmodified, with a gold arc orbiting
/// just outside it (the animation lives in index.css, .ae-logo-orbit). Stands
/// in for a plain spinner everywhere something is waiting. `color` tints the
/// arc (e.g. red inside a danger button); the logo never changes. Honors
/// prefers-reduced-motion with a static arc.
export function Spinner({
  size = "md",
  color = colors.yellow,
}: {
  size?: keyof typeof SIZES | number;
  color?: string;
}) {
  const px = typeof size === "number" ? size : SIZES[size];
  const style = { width: px, height: px, "--lp": `${px}px`, "--ring": color } as CSSProperties;
  return (
    <span aria-hidden className="ae-logo-pulse" style={style}>
      <span className="ae-logo-orbit">
        <span className="ae-logo-orbit-arc" />
        <span className="ae-logo-orbit-dot" />
      </span>
      <img
        className="ae-logo-pulse-img"
        src={LOGO_SRC}
        alt=""
        width={px}
        height={px}
        decoding="async"
        draggable={false}
      />
    </span>
  );
}

/// Centered spinner + label, dropped in wherever a page/section is waiting
/// on an async fetch (Total Stocks, Manual Count, Products, Change Log,
/// Receipts, ...) in place of a bare "Loading…" <p> - one shared look for
/// every wait state instead of each page inventing its own.
export function LoadingBlock({
  label = "Loading…",
  size = "xl",
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
        gap: 18,
        minHeight,
        padding: "16px",
        color: colors.subtleInk,
        fontSize: 13,
      }}
    >
      <Spinner size={size} />
      {label && <span style={{ fontWeight: 600 }}>{label}</span>}
    </div>
  );
}

/// Inline variant (spinner + text side by side) for tight spaces that don't
/// have room for LoadingBlock's centered column, e.g. a small card message.
export function InlineLoading({
  label = "Loading…",
  size = "md",
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
  /// 0-100, when real per-item progress exists (a multi-row Save). Shown as a
  /// number beside the label - the pulsing logo itself is indeterminate.
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
          gap: 22,
        }}
      >
        <Spinner size="xxl" />
        <span style={{ color: colors.cream, fontSize: 14, fontWeight: 600 }}>
          {label}
          {percent !== undefined && ` ${Math.round(Math.min(100, Math.max(0, percent)))}%`}
        </span>
      </div>
    </div>,
    document.body,
  );
}
