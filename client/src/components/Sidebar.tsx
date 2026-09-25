import { useEffect, type MouseEvent } from "react";
import { motion } from "motion/react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useNavDrawer } from "../context/NavDrawerContext";
import { colors } from "../theme";
import { sidebarSpring } from "../motion";

const PANEL_WIDTH = 256;
// How far below the logo the panel's top edge sits (see PageHeader.tsx's
// own +8 when it reports the anchor) plus a matching bottom margin, so a
// panel anchored low on a tall page still has room to breathe above the
// viewport's bottom edge instead of running flush against it.
const PANEL_BOTTOM_MARGIN = 16;

interface NavLinkDef {
  to: string;
  label: string;
  roles: string[];
}

const sections: { heading: string; links: NavLinkDef[] }[] = [
  {
    heading: "Data Entry",
    links: [
      { to: "/dashboard", label: "Dashboard", roles: ["SUPERVISOR_ADMIN"] },
      { to: "/online", label: "Online Entry", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
      { to: "/offline", label: "Offline Entry", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
      { to: "/manual-count", label: "Manual Count", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
      { to: "/total-stocks", label: "Total Stocks", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
      { to: "/receipts", label: "Receipts", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
    ],
  },
  {
    heading: "Reports",
    links: [
      { to: "/consolidated-receipts", label: "Consolidated Receipt", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
      { to: "/variance-report", label: "Variance Report", roles: ["SUPERVISOR_ADMIN"] },
      { to: "/daily-report", label: "Daily Report", roles: ["SUPERVISOR_ADMIN"] },
    ],
  },
  {
    heading: "Admin",
    links: [
      { to: "/change-log", label: "Change Log", roles: ["SUPERVISOR_ADMIN"] },
      { to: "/products", label: "SKUs", roles: ["SUPERVISOR_ADMIN"] },
      { to: "/delivery-destinations", label: "Delivery Destinations", roles: ["SUPERVISOR_ADMIN"] },
    ],
  },
  {
    heading: "Settings",
    links: [{ to: "/settings", label: "Settings", roles: ["SUPERVISOR_ADMIN"] }],
  },
];

/// The floating nav panel - opened from the logo button in PageHeader.tsx
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

  function blurAfterClick(e: MouseEvent<HTMLElement>) {
    e.currentTarget.blur();
  }

  function handleTabPointerMove(e: MouseEvent<HTMLAnchorElement>) {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    el.style.setProperty("--mx", `${((e.clientX - rect.left) / rect.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - rect.top) / rect.height) * 100}%`);
    el.style.setProperty("--spotlight-opacity", "1");
  }

  function handleTabPointerLeave(e: MouseEvent<HTMLAnchorElement>) {
    e.currentTarget.style.setProperty("--spotlight-opacity", "0");
  }

  const top = anchor?.top ?? 60;
  const left = anchor?.left ?? 20;

  return (
    <>
      {open && (
        // Invisible click-catcher, not a dimmed page overlay - a floating
        // popover like this (unlike the old full drawer) shouldn't darken
        // everything behind it, just close when something outside it is
        // clicked.
        <div className="no-print" onClick={close} style={{ position: "fixed", inset: 0, zIndex: 49 }} />
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
          borderRadius: 14,
          // Glass panel: notably more transparent + a stronger blur than
          // the old edge-to-edge drawer had, so it reads as floating glass
          // over the page rather than an opaque card.
          background: `color-mix(in srgb, ${colors.black} 66%, transparent)`,
          backdropFilter: "blur(24px) saturate(150%)",
          WebkitBackdropFilter: "blur(24px) saturate(150%)",
          // Same thin solid gold border as .ae-page-header (index.css),
          // rather than the old animated rainbow gradient sweep - so the
          // floating panel and the header it pops out of read as one
          // matching set of brand chrome.
          border: `1px solid ${colors.gold}`,
          color: colors.cream,
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.3)",
        }}
      >
        {/* Soft diagonal sheen - the actual "glass" highlight, on top of
            the blur/transparency above. */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: "linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0) 45%)",
          }}
        />

        <div
          className="ae-sidebar-nav"
          style={{
            padding: "16px 0",
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {sections.map((section) => {
              const visible = section.links.filter((l) => !user || l.roles.includes(user.role));
              if (visible.length === 0) return null;

              return (
                <div key={section.heading}>
                  <p
                    style={{
                      margin: "0 0 4px",
                      padding: "0 14px",
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: 0.6,
                      textTransform: "uppercase",
                      color: colors.gold,
                      opacity: 0.8,
                    }}
                  >
                    {section.heading}
                  </p>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 10px" }}>
                    {visible.map((l) => (
                      <NavLink
                        key={l.to}
                        to={l.to}
                        title={l.label}
                        onClick={(e) => {
                          blurAfterClick(e);
                          close();
                        }}
                        onMouseMove={handleTabPointerMove}
                        onMouseLeave={handleTabPointerLeave}
                        className="ae-sidebar-tab"
                        style={({ isActive }) => ({
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "flex-start",
                          width: "100%",
                          boxSizing: "border-box",
                          margin: 0,
                          padding: "10px 8px 10px 14px",
                          textDecoration: "none",
                          borderRadius: 6,
                          color: isActive ? colors.black : colors.cream,
                          background: isActive ? colors.yellow : "transparent",
                          fontWeight: isActive ? 700 : 500,
                          fontSize: 13.5,
                          fontFamily: "inherit",
                          whiteSpace: "nowrap",
                          transition: "background-color 0.15s ease, color 0.15s ease",
                        })}
                      >
                        <div
                          aria-hidden
                          className="ae-sidebar-tab-spotlight"
                          style={{
                            position: "absolute",
                            inset: 0,
                            pointerEvents: "none",
                            mixBlendMode: "screen",
                            background:
                              "radial-gradient(circle 90px at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.3), rgba(255,255,255,0.06) 55%, transparent 75%)",
                          }}
                        />
                        {l.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {user && (
            <div
              style={{
                fontSize: 12,
                color: colors.cream,
                opacity: 0.85,
                padding: "12px 14px 4px",
                borderTop: `1px solid color-mix(in srgb, ${colors.cream} 18%, transparent)`,
                flexShrink: 0,
              }}
            >
              <div style={{ overflow: "hidden", whiteSpace: "nowrap" }}>
                <div style={{ fontWeight: 600 }}>{user.name}</div>
                <div style={{ opacity: 0.75, marginBottom: 8 }}>{user.role.replace(/_/g, " ")}</div>
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
                  color: colors.gold,
                  border: `1px solid color-mix(in srgb, ${colors.gold} 55%, transparent)`,
                  borderRadius: 0,
                  padding: "4px 10px",
                }}
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
