import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { colors } from "../theme";

/**
 * A single reusable centered-overlay modal - used by the Preview dialog on
 * the data entry pages (Section 3.1) and the receipt preview/print dialog
 * (Section 4.7) rather than each page rolling its own backdrop/positioning/
 * Escape-to-close handling.
 *
 * Portaled straight onto `document.body` rather than rendered in place -
 * besides the usual stacking-context reasons, this is what lets print
 * scoping work for the receipt preview: `body.ae-printing-receipt
 * .app-shell { display: none }` (index.css) only has a chance of leaving
 * this dialog on the page if it isn't itself a descendant of `.app-shell`
 * to begin with.
 */
/// `bordered` adds a thin, square-cornered outline around the panel - opt-in
/// (used by AlertDialog) so every other dialog keeps its existing look.
export function Modal({
  title,
  onClose,
  children,
  width = 640,
  bordered = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  bordered?: boolean;
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
        background: "rgba(20, 17, 13, 0.45)",
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
          background: colors.paper,
          color: colors.ink,
          borderRadius: 0,
          border: bordered ? `1px solid ${colors.ink}` : undefined,
          boxShadow: "0 12px 40px rgba(20, 17, 13, 0.3)",
          width: "100%",
          maxWidth: width,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
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
        <div style={{ padding: 18, overflowY: "auto" }} className="ae-modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}