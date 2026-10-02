import { useEffect } from "react";
import { motion } from "motion/react";
import { useAuth } from "../context/AuthContext";
import { useNavDrawer } from "../context/NavDrawerContext";
import { sidebarSpring } from "../motion";

const PANEL_WIDTH = 256;
// How far below the logo the panel's top edge sits (see PageHeader.tsx's
// own +8 when it reports the anchor) plus a matching bottom margin, so a
// panel anchored low on a tall page still has room to breathe above the
// viewport's bottom edge instead of running flush against it.
const PANEL_BOTTOM_MARGIN = 16;

/// The floating account panel (signed-in user + log out; the page links now
/// live in HeaderTabs.tsx) - opened from the logo button in PageHeader.tsx
/// (see NavDrawerContext), not from anything in this file. Pops out from
/// wherever that logo currently sits (the anchor context reports), like a
/// Google-Sheets-style account popover, rather than a full-height drawer
/// sliding in from the viewport edge - same spring transition as before,
/// just animating scale/opacity/y from the anchor instead of an x-slide.
/// Closes on outside click or Escape.
export function Sidebar() {
  const { user, logout } = useAuth();
  const { open, anchor, close } = useNavDrawer();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const top = anchor?.top ?? 60;
  const left = anchor?.left ?? 20;

  return (
    <>
      {open && (
        // Invisible click-catcher, not a dimmed page overlay - a floating
        // popover like this (unlike the old full drawer) shouldn't darken
        // everything behind it, just close when something outside it is
        // clicked.
        <div
          className="no-print"
          onClick={close}
          style={{ position: "fixed", inset: 0, zIndex: 49 }}
        />
      )}

      <motion.div
        className="no-print"
        initial={false}
        animate={{
          opacity: open ? 1 : 0,
          scale: open ? 1 : 0.92,
          y: open ? 0 : -8,
        }}
        transition={sidebarSpring}
        style={{
          position: "fixed",
          top,
          left,
          transformOrigin: "top left",
          width: PANEL_WIDTH,
          maxHeight: `calc(100vh - ${top}px - ${PANEL_BOTTOM_MARGIN}px)`,
          zIndex: 50,
          pointerEvents: open ? "auto" : "none",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRadius: 8, // matches .ae-page-header
          // Glass panel: notably more transparent + a stronger blur than
          // the old edge-to-edge drawer had, so it reads as floating glass
          // over the page rather than an opaque card.
          // Same themed glass tokens as .ae-page-header (index.css), so the
          // drawer and the header always match - frosted cream in light
          // mode, dark glass in dark mode. The sheen is a background layer.
          background: "var(--ae-glass-sheen), var(--ae-glass-bg)",
          backdropFilter: "blur(24px) saturate(150%)",
          WebkitBackdropFilter: "blur(24px) saturate(150%)",
          // No static border: the 1px animated gradient sweep
          // (.ae-modal-border-sweep at 0.5px, rendered as the first child below)
          // draws the edge instead.
          color: "var(--ae-glass-text)",
          boxShadow: "var(--ae-glass-panel-shadow)",
        }}
      >
        {/* Extra-thin (0.5px) animated border sweep - same gradient as
            Modal, but the inline padding overrides the class's 1px. */}
        <div
          aria-hidden
          className="ae-modal-border-sweep"
          style={{ padding: 0.5 }}
        />
        <div
          className="ae-sidebar-nav"
          style={{
            padding: "4px 0 12px",
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {user && (
            <div
              style={{
                fontSize: 12,
                color: "var(--ae-glass-text)",
                opacity: 0.85,
                padding: "8px 14px 4px",
                flexShrink: 0,
              }}
            >
              <div style={{ overflow: "hidden", whiteSpace: "nowrap" }}>
                <div style={{ fontWeight: 600 }}>{user.name}</div>
                <div style={{ opacity: 0.75, marginBottom: 8 }}>
                  {user.role.replace(/_/g, " ")}
                </div>
              </div>

              <button
                onClick={logout}
                title="Log out"
                style={{
                  width: "auto",
                  fontSize: 12,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  background: "transparent",
                  color: "var(--ae-glass-accent)",
                  border:
                    "1px solid color-mix(in srgb, var(--ae-glass-accent) 55%, transparent)",
                  // Matches the nav tabs directly above it, not a leftover square corner.
                  borderRadius: 8,
                  padding: "4px 10px",
                }}
              >
                Log out
              </button>
            </div>
          )}
        </div>
        {/* App version (Section: "app version ... beside the app name") -
            __APP_VERSION__ is injected at build time from package.json
            (vite.config.ts), so this always matches whatever was actually
            built, not a hand-typed string that can drift from a real
            release. */}
        <div
          style={{
            flexShrink: 0,
            padding: "6px 14px 10px",
            fontSize: 11,
            color: "var(--ae-glass-text)",
            opacity: 0.55,
            borderTop: "1px solid color-mix(in srgb, var(--ae-glass-text) 15%, transparent)",
          }}
        >
          Ala Eh Stocks Monitoring System · v{__APP_VERSION__}
        </div>
      </motion.div>
    </>
  );
}
