import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent } from "react";
import { motion, type Transition } from "framer-motion";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { LogoMark } from "./LogoMark";
import { colors, fonts } from "../theme";

/**
 * Section: nav rail. Three states, spring-animated with Framer Motion:
 *
 * - Rail (default) - a 72px icon-only strip.
 * - Expanded - hovering the rail (mouse, or Tab-focusing a link inside)
 *   grows it to 256px, revealing full labels and section headings; it
 *   shrinks back on mouseLeave/blur.
 * - Collapsed - clicking the brand logo folds the whole rail down into a
 *   single still 40x40 icon in the top-left corner; clicking that icon
 *   springs it back to the rail.
 *
 * The rail itself is `position: fixed` (so its width/height/border-radius/
 * position can all spring-animate freely between very different shapes -
 * a tall 72px strip vs. a 40x40 circle - without a normal flex layout
 * fighting that). A same-sized `motion.div` spacer sits in main's actual
 * flex flow instead, animated in lockstep, so the page content next to it
 * reflows smoothly rather than jumping when the rail's width changes.
 */

const RAIL_WIDTH = 72;
const EXPANDED_WIDTH = 256;
const ICON_SIZE = 40;
const ICON_INSET = 16;

const SIDEBAR_COLLAPSED_KEY = "ae-sidebar-collapsed-icon";

const spring: Transition = { type: "spring", stiffness: 340, damping: 32, mass: 0.8 };

interface NavLinkDef {
  to: string;
  label: string;
  abbr: string;
  roles: string[];
}

const sections: { heading: string; links: NavLinkDef[] }[] = [
  {
    heading: "Data Entry",
    links: [
      { to: "/online", label: "Online Entry", abbr: "ON", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
      { to: "/offline", label: "Offline Entry", abbr: "OF", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
      { to: "/total-stocks", label: "Total Stocks", abbr: "TS", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
      { to: "/manual-count", label: "Manual Count", abbr: "MC", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
      { to: "/receipts", label: "Receipts", abbr: "RC", roles: ["ONLINE_ENCODER", "SUPERVISOR_ADMIN"] },
    ],
  },
  {
    heading: "Reports",
    links: [
      { to: "/variance-report", label: "Variance Report", abbr: "VR", roles: ["SUPERVISOR_ADMIN"] },
      { to: "/daily-report", label: "Daily Report", abbr: "DR", roles: ["SUPERVISOR_ADMIN"] },
    ],
  },
  {
    heading: "Admin",
    links: [
      { to: "/change-log", label: "Change Log", abbr: "CL", roles: ["SUPERVISOR_ADMIN"] },
      { to: "/products", label: "Products", abbr: "PR", roles: ["SUPERVISOR_ADMIN"] },
    ],
  },
];

function readInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function Sidebar() {
  const { user, logout } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);

  const [collapsed, setCollapsed] = useState(readInitialCollapsed);
  const [isMouseOver, setIsMouseOver] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 900));

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Ignore - still works for this session, just won't be remembered.
    }
  }, [collapsed]);

  // Collapsed no longer reserves any in-flow width (see spacerWidth below) -
  // the floating icon sits on top of main's content instead of pushing it
  // over, so the table/toolbar can use every pixel horizontally. That would
  // otherwise leave the icon overlapping whatever's at the very top-left of
  // the page (a heading, an intro line) - this class lets index.css nudge
  // just that heading over so it starts beside the icon instead of behind
  // it, without every page needing to know the sidebar exists.
  useEffect(() => {
    document.body.classList.toggle("ae-sidebar-collapsed-icon", collapsed);
    return () => document.body.classList.remove("ae-sidebar-collapsed-icon");
  }, [collapsed]);

  useEffect(() => {
    // Resize fires far faster than React (or Framer Motion) needs to know
    // about it - coalesce to one update per animation frame instead of one
    // setState per event, so dragging the window edge doesn't spam
    // re-renders.
    let frame = 0;
    function onResize() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setViewportHeight(window.innerHeight));
    }
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Hover (mouse) and keyboard focus both count as "expanded" - matches
  // hovering the rail with a mouse. Only meaningful while not collapsed;
  // the collapsed icon only ever opens back up via a click (see below).
  const hovered = !collapsed && (isMouseOver || isFocusWithin);
  const state: "rail" | "expanded" | "collapsed" = collapsed ? "collapsed" : hovered ? "expanded" : "rail";

  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    if (!containerRef.current?.contains(e.relatedTarget as Node | null)) {
      setIsFocusWithin(false);
    }
  }

  // A clicked NavLink keeps keyboard focus afterward, which would
  // otherwise keep isFocusWithin (and so "expanded") true even once the
  // mouse has moved away and navigation is done - blurring right after
  // the click lets the rail fold back to the rail state like a plain
  // hover-out would, so it always stays minimized once you're done with it.
  function blurAfterClick(e: MouseEvent<HTMLElement>) {
    e.currentTarget.blur();
  }

  function toggleCollapsed() {
    setCollapsed((prev) => !prev);
  }

  const width = state === "collapsed" ? ICON_SIZE : state === "expanded" ? EXPANDED_WIDTH : RAIL_WIDTH;
  const height = state === "collapsed" ? ICON_SIZE : viewportHeight;
  // The corner inset is expressed as a transform (x/y), not top/left -
  // top/left are layout properties (the browser has to reflow to move
  // them), while x/y are compositor-only, so this one part of the spring
  // animation is effectively free instead of triggering layout on every
  // frame. `top`/`left` themselves stay a constant 0 in the style prop.
  const inset = state === "collapsed" ? ICON_INSET : 0;
  // Same 4-value corner template in every state (top-left top-right
  // bottom-right bottom-left) so Framer Motion's string interpolation
  // tweens each corner independently instead of snapping - flush against
  // the edge at rest, a touch more rounded once popped out on hover, and a
  // perfect circle (half of 40px) once folded down to just the icon.
  const borderRadius = state === "collapsed" ? "20px 20px 20px 20px" : state === "expanded" ? "0px 20px 20px 0px" : "0px 14px 14px 0px";

  // Reserves exactly as much width in the normal flex flow as the fixed
  // rail visually needs, so main never renders underneath it and never has
  // to jump when the rail's own width changes - it just reflows in step
  // with the same spring. Collapsed reserves nothing at all - the whole
  // point of folding down to just the icon is to hand every pixel of that
  // space back to the toolbar/table (a real gain on a narrow screen, where
  // even the icon's own inset was a meaningful slice of the width), so the
  // floating icon is left to sit on top of main's content in that state
  // instead of pushing it over.
  const spacerWidth = state === "collapsed" ? 0 : width;

  return (
    <>
      <motion.div
        className="no-print"
        aria-hidden
        animate={{ width: spacerWidth }}
        transition={spring}
        style={{ flexShrink: 0, height: "100%" }}
      />
      <motion.div
        ref={containerRef}
        className="no-print"
        onMouseEnter={() => setIsMouseOver(true)}
        onMouseLeave={() => setIsMouseOver(false)}
        onFocus={() => setIsFocusWithin(true)}
        onBlur={handleBlur}
        animate={{ width, height, x: inset, y: inset, borderRadius }}
        transition={spring}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 50,
          overflow: "hidden",
          background: colors.blackSoft,
          color: colors.cream,
          boxShadow: state === "collapsed" ? "0 4px 16px rgba(20,17,13,0.35)" : "none",
        }}
      >
        <div style={{ padding: state === "collapsed" ? 0 : "20px 14px", height: "100%", display: "flex", flexDirection: "column" }}>
          <div
            onClick={(e) => {
              toggleCollapsed();
              blurAfterClick(e);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleCollapsed();
              }
            }}
            role="button"
            tabIndex={0}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar into icon"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar into icon"}
            style={{
              display: "flex",
              alignItems: "center",
              // Always flex-start (never centered) so the logo's own
              // position never drifts by a couple of px between rail and
              // expanded just because the row briefly has no other
              // content to sit beside - it should only ever move when
              // .collapsed actually repositions the whole rail.
              justifyContent: "flex-start",
              gap: state === "expanded" ? 10 : 0,
              width: state === "collapsed" ? ICON_SIZE : "100%",
              height: state === "collapsed" ? ICON_SIZE : "auto",
              marginBottom: state === "collapsed" ? 0 : 20,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {/* Constant 40x40 in every state - never scaled or resized, so
                this is the one visual anchor the rest of the rail folds
                down to or grows out from. */}
            <LogoMark size={ICON_SIZE} />
            {state === "expanded" && (
              <div style={{ overflow: "hidden", whiteSpace: "nowrap" }}>
                <h1 style={{ fontFamily: fonts.wordmark, fontSize: 16, fontWeight: 800, color: colors.yellow, margin: 0, lineHeight: 1.1 }}>
                  Ala Eh!
                </h1>
                <p style={{ fontSize: 10.5, color: colors.cream, opacity: 0.75, margin: 0, letterSpacing: 0.3 }}>Stocks Monitoring</p>
              </div>
            )}
          </div>

          {/* Everything except the logo - fades/scales/slides away as the
              rail folds into the icon, instead of just vanishing, so the
              collapse reads as one continuous motion. */}
          <motion.div
            animate={{ opacity: collapsed ? 0 : 1, scale: collapsed ? 0.6 : 1, y: collapsed ? -20 : 0 }}
            transition={spring}
            style={{ pointerEvents: collapsed ? "none" : "auto", flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
              {sections.map((section) => {
                const visible = section.links.filter((l) => !user || l.roles.includes(user.role));
                if (visible.length === 0) return null;
                return (
                  <div key={section.heading}>
                    {state === "expanded" && (
                      <p
                        style={{
                          margin: "0 0 4px",
                          padding: "0 10px",
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
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {visible.map((l) => (
                        <NavLink
                          key={l.to}
                          to={l.to}
                          title={l.label}
                          tabIndex={collapsed ? -1 : undefined}
                          onClick={blurAfterClick}
                          style={({ isActive }): CSSProperties => ({
                            display: "flex",
                            alignItems: "center",
                            justifyContent: state === "expanded" ? "flex-start" : "center",
                            padding: state === "expanded" ? "8px 10px" : "8px 4px",
                            borderRadius: 6,
                            textDecoration: "none",
                            color: isActive ? colors.black : colors.cream,
                            background: isActive ? colors.yellow : "transparent",
                            fontWeight: isActive ? 700 : 500,
                            fontSize: 13.5,
                            whiteSpace: "nowrap",
                          })}
                        >
                          {state === "expanded" ? l.label : l.abbr}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ flex: 1 }} />

            {user && (
              // Border spans the full rail width (negative margin cancels
              // the padding above); the text/button inside is padded back
              // in so its left edge lines up with the link labels.
              <div
                style={{
                  fontSize: 12,
                  color: colors.cream,
                  opacity: 0.85,
                  margin: "0 -14px",
                  padding: state === "expanded" ? "12px 24px 4px" : "12px 8px 4px",
                  borderTop: `1px solid ${colors.goldDark}`,
                  flexShrink: 0,
                }}
              >
                {state === "expanded" && (
                  <div style={{ overflow: "hidden", whiteSpace: "nowrap" }}>
                    <div style={{ fontWeight: 600 }}>{user.name}</div>
                    <div style={{ opacity: 0.75, marginBottom: 8 }}>{user.role.replace(/_/g, " ")}</div>
                  </div>
                )}
                <button
                  onClick={logout}
                  title="Log out"
                  tabIndex={collapsed ? -1 : undefined}
                  style={{
                    width: state === "expanded" ? "auto" : "100%",
                    fontSize: 12,
                    cursor: "pointer",
                    background: "transparent",
                    color: colors.gold,
                    border: `1px solid ${colors.goldDark}`,
                    borderRadius: 5,
                    padding: state === "expanded" ? "4px 10px" : "4px 0",
                  }}
                >
                  {state === "expanded" ? "Log out" : "⏻"}
                </button>
              </div>
            )}
          </motion.div>
        </div>
      </motion.div>
    </>
  );
}
