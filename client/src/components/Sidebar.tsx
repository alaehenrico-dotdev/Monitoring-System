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
      {
        to: "/online",
        label: "Online Entry",
        roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"],
      },
      {
        to: "/offline",
        label: "Offline Entry",
        roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"],
      },
      {
        to: "/manual-count",
        label: "Audit",
        roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"],
      },
      {
        to: "/total-stocks",
        label: "Total Stocks",
        roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"],
      },
    ],
  },
  {
    heading: "Reports",
    links: [
      {
        to: "/variance-report",
        label: "Variance Report",
        roles: ["SUPERVISOR_ADMIN"],
      },
      {
        to: "/daily-report",
        label: "Daily Report",
        roles: ["SUPERVISOR_ADMIN"],
      },
    ],
  },
  {
    heading: "Admin",
    links: [
      { to: "/change-log", label: "Change Log", roles: ["SUPERVISOR_ADMIN"] },
      { to: "/products", label: "SKUs", roles: ["SUPERVISOR_ADMIN"] },
      {
        to: "/delivery-destinations",
        label: "Delivery Destinations",
        roles: ["SUPERVISOR_ADMIN"],
      },
    ],
  },
  {
    heading: "Settings",
    links: [
      { to: "/settings", label: "Settings", roles: ["SUPERVISOR_ADMIN"] },
    ],
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
    el.style.setProperty(
      "--mx",
      `${((e.clientX - rect.left) / rect.width) * 100}%`,
    );
    el.style.setProperty(
      "--my",
      `${((e.clientY - rect.top) / rect.height) * 100}%`,
    );
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
              const visible = section.links.filter(
                (l) => !user || l.roles.includes(user.role),
              );
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
                      color: "var(--ae-glass-accent)",
                      opacity: 0.9,
                    }}
                  >
                    {section.heading}
                  </p>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      padding: "0 10px",
                    }}
                  >
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
                          borderRadius: 8,
                          color: isActive
                            ? colors.black
                            : "var(--ae-glass-text)",
                          background: isActive ? colors.yellow : "transparent",
                          fontWeight: isActive ? 700 : 500,
                          fontSize: 13.5,
                          fontFamily: "inherit",
                          whiteSpace: "nowrap",
                          transition:
                            "background-color 0.15s ease, color 0.15s ease",
                        })}
                      >
                        <div aria-hidden className="ae-sidebar-tab-spotlight" />
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
                color: "var(--ae-glass-text)",
                opacity: 0.85,
                padding: "12px 14px 4px",
                borderTop: "1px solid var(--ae-glass-divider)",
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
      </motion.div>
    </>
  );
}
