import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { colors } from "../theme";

export type ToastVariant = "info" | "error";

interface ToastProps {
  message: string | null;
  onDismiss: () => void;
  variant?: ToastVariant;
  /// ms before auto-dismissing; null keeps it up until the user closes it
  /// (or a later action replaces the message) - used for anything worth
  /// reading in full rather than glancing past, e.g. an import that failed
  /// or turned up unmatched rows.
  duration?: number | null;
}

const ACCENT: Record<ToastVariant, string> = {
  info: colors.gold,
  error: colors.danger,
};

/**
 * A lower-right notification, portaled straight onto document.body (same
 * reasoning as Modal.tsx) - so it renders consistently regardless of which
 * toolbar/page embeds the component that triggers it, and floats above the
 * page instead of competing for space in an already-crowded toolbar row
 * (its original home, as an inline <span> next to CsvTools' Import button).
 */
export function Toast({ message, onDismiss, variant = "info", duration = 6000 }: ToastProps) {
  useEffect(() => {
    if (!message || duration === null) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onDismiss]);

  return createPortal(
    <div
      aria-live="polite"
      className="no-print"
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 300,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: 360,
        maxWidth: "calc(100vw - 40px)",
        pointerEvents: "none",
      }}
    >
      <AnimatePresence>
        {message && (
          <motion.div
            key={message}
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
              boxShadow: "0 8px 28px rgba(20, 17, 13, 0.28)",
              padding: "12px 14px",
              fontSize: 12.5,
              lineHeight: 1.45,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <span style={{ flex: 1, wordBreak: "break-word" }}>{message}</span>
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
      </AnimatePresence>
    </div>,
    document.body,
  );
}