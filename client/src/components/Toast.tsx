import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { colors } from "../theme";

export type ToastVariant = "info" | "error" | "warning";

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

const ACCENT: Record<ToastVariant, string> = {
  info: colors.gold,
  error: colors.danger,
  warning: colors.warningText,
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
          style={{
            pointerEvents: "auto",
            background: colors.surface,
            color: colors.ink,
            border: `1px solid ${colors.border}`,
            borderLeft: `3px solid ${ACCENT[variant]}`,
            borderRadius: 6,
            boxShadow: "0 8px 28px rgba(12, 12, 12, 0.28)",
            padding: "12px 14px",
            fontSize: 12.5,
            lineHeight: 1.45,
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
            {message}
          </div>
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 12.5,
                fontWeight: 700,
                lineHeight: 1.45,
                textDecoration: "underline",
                color: colors.ink,
                padding: 2,
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              {action.label}
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            title="Dismiss"
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
              color: colors.subtleInk,
              padding: 2,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    getStack(),
  );
}

// ---- Imperative toasts, for code that isn't a React component (e.g. the
// desktop updater, which used to call window.alert). <ToastHost/> is mounted
// once in Layout and renders whatever showToast() last published.
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
