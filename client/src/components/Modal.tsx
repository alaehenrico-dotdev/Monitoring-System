import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { colors } from "../theme";

/**
 * A single reusable centered-overlay modal - used by the Preview dialog on
 * the data entry pages (Section 3.1) and every other confirm/preview dialog
 * in the app, rather than each page rolling its own backdrop/positioning/
 * Escape-to-close handling.
 *
 * Portaled straight onto `document.body` rather than rendered in place, for
 * the usual stacking-context reasons.
 */
export function Modal({
  title,
  onClose,
  children,
  width = 640,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      role="presentation"
      onClick={onClose}
      className="ae-modal-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(12, 12, 12, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="ae-modal-panel"
        style={{
          position: "relative",
          background: colors.paper,
          color: colors.ink,
          // Same 8px radius as .ae-page-header/.ae-datepicker/.ae-dropdown -
          // overflow: hidden clips the header/body's square corners to it.
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 12px 40px rgba(12, 12, 12, 0.3)",
          width: "100%",
          maxWidth: width,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* 0.5px (the class default is 1px) - same thin edge as the nav drawer. */}
        <div
          aria-hidden
          className="ae-modal-border-sweep"
          style={{ padding: 0.5 }}
        />
        <div
          className="ae-modal-header no-print"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: `1px solid ${colors.border}`,
            flexShrink: 0,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              color: colors.subtleInk,
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>
        <div
          style={{ padding: 18, overflowY: "auto" }}
          className="ae-modal-body"
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
