import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";

export type ToastVariant = "info" | "success" | "error" | "warning";

interface ToastProps {
  /// String or JSX; null hides the toast.
  message: ReactNode | null;
  onDismiss: () => void;
  variant?: ToastVariant;
  /// ms before auto-dismissing; null keeps it up until the user closes it
  /// (or a later action replaces the message) - used for anything worth
  /// reading in full rather than glancing past, e.g. an import that failed
  /// or turned up unmatched rows.
  duration?: number | null;
  /// A single inline action alongside the dismiss ✕ (e.g. "Undo Import") -
  /// scoped to whatever `message` currently is. The caller owns clearing
  /// this itself (alongside `message`, or sooner) so it doesn't outlive the
  /// specific toast it belongs to - this component doesn't try to guess
  /// that on its own.
  action?: { label: string; onClick: () => void };
  /// Identity of the message, used to restart the entrance animation and the
  /// auto-dismiss timer when the message changes. Defaults to the message
  /// itself when it's a string; pass one when `message` is JSX.
  id?: string;
  /// No longer used: every toast now shares one bottom-right stack (see
  /// getStack) so they can't overlap. Kept so existing call sites compile.
  offset?: number;
}

/**
 * One hue per variant, used for both the icon tile's fill and its glyph (see
 * ToastIcon below). Fixed hex rather than the theme tokens: the tile is a
 * small saturated badge that has to read as "good / bad / careful" at a
 * glance in both light and dark mode, and `colors.danger`/`warningText` are
 * body-text colors tuned for contrast against the page, not for this.
 */
const HUE: Record<ToastVariant, string> = {
  info: "#4C8DF6",
  success: "#27A567",
  error: "#E03E52",
  warning: "#E0A800",
};

/// 16px glyphs, drawn rather than typed: the check/cross/bang in the system
/// font sit off-centre at this size and shift between platforms.
function ToastIcon({ variant }: { variant: ToastVariant }) {
  const stroke = {
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
    stroke: "currentColor",
  };
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden focusable="false">
      {variant === "success" && <path d="M3.5 8.5 6.5 11.5 12.5 5" {...stroke} />}
      {variant === "error" && <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" {...stroke} />}
      {variant !== "success" && variant !== "error" && (
        <>
          <circle cx="8" cy="8" r="5.75" {...stroke} />
          {variant === "warning" ? (
            <path d="M8 5.25V8.5M8 10.75v.01" {...stroke} />
          ) : (
            <path d="M8 7.5v3.25M8 5.25v.01" {...stroke} />
          )}
        </>
      )}
    </svg>
  );
}

const VARIANT_LABEL: Record<ToastVariant, string> = {
  info: "Information",
  success: "Success",
  error: "Error",
  warning: "Warning",
};

/**
 * One fixed bottom-right container shared by every Toast on the page, so
 * several toasts at once (a save error plus a shift warning plus an offline
 * notice) stack neatly instead of each portaling to the same spot.
 * Newest sits on top; the oldest stays at the corner.
 */
function getStack(): HTMLElement {
  let el = document.getElementById("ae-toast-stack");
  if (!el) {
    el = document.createElement("div");
    el.id = "ae-toast-stack";
    el.className = "no-print";
    el.setAttribute("aria-live", "polite");
    Object.assign(el.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: "300",
      display: "flex",
      flexDirection: "column-reverse",
      gap: "8px",
      width: "360px",
      maxWidth: "calc(100vw - 40px)",
      pointerEvents: "none",
    });
    document.body.appendChild(el);
  }
  return el;
}

/**
 * A lower-right notification, portaled into the shared stack on
 * document.body (same reasoning as Modal.tsx) - so it renders consistently
 * regardless of which toolbar/page embeds the component that triggers it,
 * and floats above the page instead of pushing content (e.g. a table) down.
 */
export function Toast({
  message,
  onDismiss,
  variant = "info",
  duration = 6000,
  action,
  id,
}: ToastProps) {
  const dismissRef = useRef(onDismiss);
  // Synced in an effect rather than during render (refs must not be written
  // while rendering). Only ever read from the timeout below, which fires
  // after this has committed, so the timer still calls the latest onDismiss.
  useEffect(() => {
    dismissRef.current = onDismiss;
  });
  const hasMessage =
    message !== null &&
    message !== undefined &&
    message !== false &&
    message !== "";
  const key = id ?? (typeof message === "string" ? message : "toast");

  // Depends on the message's identity, not on `onDismiss` (usually an inline
  // arrow) so a parent re-render doesn't keep restarting the timer.
  useEffect(() => {
    if (!hasMessage || duration === null) return;
    const timer = setTimeout(() => dismissRef.current(), duration);
    return () => clearTimeout(timer);
  }, [hasMessage, key, duration]);

  return createPortal(
    <AnimatePresence>
      {hasMessage && (
        <motion.div
          key={key}
          layout
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.2 }}
          role="status"
          className="ae-toast"
          style={{ pointerEvents: "auto" }}
        >
          {/* The variant reads as a coloured badge rather than an edge stripe:
              at a glance it is the only thing that has to be seen, and it
              carries the same meaning to someone who can't separate a 3px
              red border from a 3px amber one. */}
          <span
            className="ae-toast-icon"
            role="img"
            aria-label={VARIANT_LABEL[variant]}
            style={{
              color: HUE[variant],
              background: `color-mix(in srgb, ${HUE[variant]} 20%, var(--ae-surface))`,
              borderColor: `color-mix(in srgb, ${HUE[variant]} 40%, transparent)`,
            }}
          >
            <ToastIcon variant={variant} />
          </span>
          <div className="ae-toast-message">{message}</div>
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="ae-toast-action"
            >
              {action.label}
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            title="Dismiss"
            className="ae-toast-close"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden focusable="false">
              <path
                d="M4 4 12 12M12 4 4 12"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
              />
            </svg>
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    getStack(),
  );
}

// ---- Imperative toasts, for code that isn't a React component. <ToastHost/>
// is mounted once in Layout and renders whatever showToast() last published.
interface PendingToast {
  id: number;
  message: string;
  variant: ToastVariant;
  duration: number | null;
}
let current: PendingToast | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

export function showToast(
  message: string,
  variant: ToastVariant = "info",
  duration: number | null = 10000,
) {
  current = { id: nextId++, message, variant, duration };
  listeners.forEach((l) => l());
}

function clearToast() {
  current = null;
  listeners.forEach((l) => l());
}

export function ToastHost() {
  const t = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  return (
    <Toast
      message={t?.message ?? null}
      id={t ? String(t.id) : undefined}
      variant={t?.variant}
      duration={t?.duration ?? 10000}
      onDismiss={clearToast}
    />
  );
}
