import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
} from "react";
import { motion } from "motion/react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { LogoMark } from "./LogoMark";
import { PinIcon } from "./icons";
import { colors, fonts } from "../theme";
import { sidebarSpring } from "../motion";

const RAIL_WIDTH = 56;
const EXPANDED_WIDTH = 256;
const ICON_SIZE = 40;
const ICON_INSET = 16;
const TAB_BADGE_SIZE = 36;

const SIDEBAR_COLLAPSED_KEY = "ae-sidebar-collapsed-icon";
const SIDEBAR_PINNED_KEY = "ae-sidebar-pinned";

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
      { to: "/dashboard", label: "Dashboard", abbr: "DB", roles: ["SUPERVISOR_ADMIN"] },
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
      { to: "/products", label: "SKUs", abbr: "SK", roles: ["SUPERVISOR_ADMIN"] },
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

function readInitialPinned(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_PINNED_KEY) === "1";
  } catch {
    return false;
  }
}

const NAV_STYLE_TAG_ID = "ae-sidebar-nav-style";
// Hover rules live here (not inline) because they need `!important` to win
// against the tabs' own inline `background`/`color`, which is set per-row
// based on `isActive`. `:not([aria-current="page"])` keeps hover from ever
// fighting the active tab's own solid highlight - React Router sets
// aria-current="page" on the active NavLink automatically, so this needs
// no extra prop threading.
const NAV_STYLE = `
  .ae-sidebar-nav {
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* old Edge / IE */
  }
  .ae-sidebar-nav::-webkit-scrollbar {
    display: none; /* Chrome, Safari, new Edge */
    width: 0;
    height: 0;
  }
  .ae-sidebar-tab:hover:not([aria-current="page"]) {
    background: color-mix(in srgb, ${colors.yellow} 16%, transparent) !important;
    color: ${colors.yellow} !important;
  }
  .ae-sidebar-tab:hover:not([aria-current="page"]) .ae-sidebar-tab-badge {
    background: color-mix(in srgb, ${colors.yellow} 22%, transparent);
    color: ${colors.yellow};
  }
  .ae-sidebar-logo {
    transition: transform 0.25s ease;
  }
  .ae-sidebar-logo:hover {
    transform: scale(1.08) rotate(-4deg);
  }
  .ae-sidebar-logo:active {
    transform: scale(0.94) rotate(0deg);
  }
  @keyframes ae-sidebar-gradient-position {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }
  .ae-sidebar-gradient-sweep {
    animation: ae-sidebar-gradient-position 3.2s linear infinite;
  }
`;

export function Sidebar() {
  const { user, logout } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);

  const [collapsed, setCollapsed] = useState(readInitialCollapsed);
  const [pinned, setPinned] = useState(readInitialPinned);
  const [isMouseOver, setIsMouseOver] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : 900,
  );

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Ignore - still works for this session, just won't be remembered.
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_PINNED_KEY, pinned ? "1" : "0");
    } catch {
      // Ignore - still works for this session, just won't be remembered.
    }
  }, [pinned]);

  useEffect(() => {
    if (document.getElementById(NAV_STYLE_TAG_ID)) return;
    const style = document.createElement("style");
    style.id = NAV_STYLE_TAG_ID;
    style.textContent = NAV_STYLE;
    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("ae-sidebar-collapsed-icon", collapsed);
    return () => document.body.classList.remove("ae-sidebar-collapsed-icon");
  }, [collapsed]);

  useEffect(() => {
    let frame = 0;
    function onResize() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setViewportHeight(window.innerHeight),
      );
    }
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Pinned holds the sidebar in "expanded" permanently (no hover needed) -
  // same effect as isMouseOver/isFocusWithin, just sourced from a click
  // instead of the pointer, and remembered across reloads.
  const hovered = !collapsed && (isMouseOver || isFocusWithin || pinned);
  const state: "rail" | "expanded" | "collapsed" = collapsed
    ? "collapsed"
    : hovered
      ? "expanded"
      : "rail";

  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    if (!containerRef.current?.contains(e.relatedTarget as Node | null)) {
      setIsFocusWithin(false);
    }
  }

  function blurAfterClick(e: MouseEvent<HTMLElement>) {
    e.currentTarget.blur();
  }

  function toggleCollapsed() {
    setCollapsed((prev) => !prev);
  }

  function togglePinned() {
    setPinned((prev) => !prev);
  }

  const width =
    state === "collapsed"
      ? ICON_SIZE
      : state === "expanded"
        ? EXPANDED_WIDTH
        : RAIL_WIDTH;
  const height = state === "collapsed" ? ICON_SIZE : viewportHeight;
  const inset = state === "collapsed" ? ICON_INSET : 0;
  const borderRadius =
    state === "collapsed"
      ? "70px 70px 70px 70px"
      : state === "expanded"
        ? "0px 0px 0px 0px"
        : "0px 0px 0px 0px";
  const spacerWidth = state === "collapsed" ? 0 : width;

  return (
    <>
      {/* Real `animate={{ width: ... }}`, not `layout` - `layout` FLIPs a
          resize via a transform (scale) trick, which visually squishes
          whatever's actually rendered inside the box while it's mid-
          transition. That's invisible on this plain-color spacer, but the
          same trick on `<main>` (see Layout.tsx) visibly distorted real
          page content (grid text) while resizing, which read as ugly rather
          than smooth. Animating the real `width` instead costs an extra
          reflow per frame, but is what makes both this spacer and main's
          own resize (Layout.tsx) actually smooth rather than faked. */}
      <motion.div
        className="no-print"
        aria-hidden
        animate={{ width: spacerWidth }}
        transition={sidebarSpring}
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
        transition={sidebarSpring}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 50,
          overflow: "hidden",
          background: `color-mix(in srgb, ${colors.black} 82%, transparent)`,
          backdropFilter: "blur(20px) saturate(120%)",
          WebkitBackdropFilter: "blur(20px) saturate(120%)",
          // The static border is only drawn when NOT expanded. While
          // expanded, the border is rendered by the animated overlay below
          // so it can pulse without fighting this element's own width/height
          // spring transition (animating two different `transition`
          // configs on one element isn't possible with framer-motion).
          border:
            state === "expanded"
              ? "1px solid transparent"
              : `1px solid ${colors.yellow}`,
          color: colors.cream,
          boxShadow:
            state === "collapsed"
              ? "0 8px 24px rgba(0,0,0,0.55)"
              : "0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        {state === "expanded" && (
          // Gradient-border trick: this element is padded by exactly the
          // border width, filled with a moving gradient, then masked so
          // only that padding ring (not the center) is visible - the
          // `xor`/`exclude` composite punches the content-box out of the
          // full box, leaving a ring the same shape as `borderRadius`.
          //
          // A plain CSS `animation` (see NAV_STYLE), not a Framer Motion
          // `animate` loop - `background-position` never runs on the
          // compositor, so a JS-driven `repeat: Infinity` was repainting
          // this whole viewport-height layer forever, on the main thread,
          // for as long as the sidebar stayed expanded (indefinitely, once
          // pinned). The native CSS engine runs the identical keyframes
          // without that per-frame JS/React overhead.
          <div
            aria-hidden
            className="ae-sidebar-gradient-sweep"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "inherit",
              padding: 1.5,
              pointerEvents: "none",
              // Black stops between each highlight color are what make the
              // sweep read clearly - without them the yellow/gold/cream
              // trio blends into one continuous warm glow with too little
              // contrast against the dark sidebar background.
              backgroundImage: `linear-gradient(115deg, ${colors.black}, ${colors.yellow}, ${colors.black}, ${colors.gold}, ${colors.black}, ${colors.cream}, ${colors.black}, ${colors.gold}, ${colors.black}, ${colors.yellow}, ${colors.black})`,
              backgroundSize: "400% 400%",
              WebkitMask:
                "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
              WebkitMaskComposite: "xor",
              maskComposite: "exclude",
            }}
          />
        )}
        <div
          style={{
            padding: state === "collapsed" ? 0 : "20px 0",
            height: "100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            className="ae-sidebar-logo"
            onClick={(e) => {
              toggleCollapsed();
              blurAfterClick(e);
            }}
            onKeyDown={(e) => {
              // Ignore key events bubbling up from the pin button below -
              // it's its own focusable control, not part of this row's
              // collapse/expand toggle.
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleCollapsed();
              }
            }}
            role="button"
            tabIndex={0}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar into icon"}
            aria-label={
              collapsed ? "Expand sidebar" : "Collapse sidebar into icon"
            }
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: state === "expanded" ? 10 : 0,
              width: state === "collapsed" ? ICON_SIZE : "100%",
              boxSizing: "border-box",
              paddingLeft:
                state === "collapsed" ? 0 : state === "expanded" ? 14 : 8,
              paddingRight:
                state === "collapsed" ? 0 : state === "expanded" ? 14 : 8,
              height: state === "collapsed" ? ICON_SIZE : "auto",
              marginBottom: state === "collapsed" ? 0 : 20,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <LogoMark size={ICON_SIZE} />
            {state === "expanded" && (
              <div style={{ overflow: "hidden", whiteSpace: "nowrap" }}>
                <h1
                  style={{
                    fontFamily: fonts.wordmark,
                    fontSize: 16,
                    fontWeight: 800,
                    color: colors.yellow,
                    margin: 0,
                    lineHeight: 1.1,
                  }}
                >
                  Ala Eh!
                </h1>
                <p
                  style={{
                    fontSize: 10.5,
                    color: colors.cream,
                    opacity: 0.75,
                    margin: 0,
                    letterSpacing: 0.3,
                  }}
                >
                  Stocks Monitoring
                </p>
              </div>
            )}
            {state === "expanded" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePinned();
                  // Otherwise this button stays DOM-focused after the
                  // click, and focus-within (see `hovered` above) would
                  // keep the sidebar expanded regardless of `pinned` until
                  // something else steals focus - same reason toggleCollapsed
                  // blurs its own trigger.
                  blurAfterClick(e);
                }}
                title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
                aria-label={pinned ? "Unpin sidebar" : "Pin sidebar open"}
                aria-pressed={pinned}
                style={{
                  marginLeft: "auto",
                  flexShrink: 0,
                  width: 26,
                  height: 26,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "50%",
                  border: "none",
                  background: pinned ? colors.yellow : "transparent",
                  color: pinned ? colors.black : colors.cream,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "background-color 0.15s ease, color 0.15s ease",
                }}
              >
                <PinIcon filled={pinned} />
              </button>
            )}
          </div>

          <motion.div
            animate={{
              opacity: collapsed ? 0 : 1,
              scale: collapsed ? 0.6 : 1,
              y: collapsed ? -20 : 0,
            }}
            transition={sidebarSpring}
            style={{
              pointerEvents: collapsed ? "none" : "auto",
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              className="ae-sidebar-nav"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                overflowY: "auto",
                overflowX: "hidden",
              }}
            >
              {sections.map((section) => {
                const visible = section.links.filter(
                  (l) => !user || l.roles.includes(user.role),
                );
                if (visible.length === 0) return null;
                return (
                  <div key={section.heading}>
                    {state === "expanded" && (
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
                    )}
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {visible.map((l) => (
                        <NavLink
                          key={l.to}
                          to={l.to}
                          title={l.label}
                          tabIndex={collapsed ? -1 : undefined}
                          onClick={blurAfterClick}
                          className="ae-sidebar-tab"
                          style={({ isActive }): CSSProperties => ({
                            display: "flex",
                            alignItems: "center",
                            justifyContent:
                              state === "expanded" ? "flex-start" : "center",
                            width: "100%",
                            boxSizing: "border-box",
                            margin: 0,
                            padding:
                              state === "expanded" ? "10px 14px" : "6px 0",
                            borderRadius: 0,
                            textDecoration: "none",
                            color:
                              state === "expanded"
                                ? isActive
                                  ? colors.black
                                  : colors.cream
                                : colors.cream,
                            background:
                              state === "expanded"
                                ? isActive
                                  ? colors.yellow
                                  : "transparent"
                                : "transparent",
                            fontWeight:
                              state === "expanded"
                                ? isActive
                                  ? 700
                                  : 500
                                : 500,
                            fontSize: 13.5,
                            fontFamily: "inherit",
                            whiteSpace: "nowrap",
                            transition: "background-color 0.15s ease, color 0.15s ease",
                          })}
                        >
                          {({ isActive }: { isActive: boolean }) =>
                            state === "expanded" ? (
                              l.label
                            ) : (
                              <span
                                className="ae-sidebar-tab-badge"
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: TAB_BADGE_SIZE,
                                  height: TAB_BADGE_SIZE,
                                  borderRadius: "50%",
                                  background: isActive
                                    ? colors.yellow
                                    : "transparent",
                                  color: isActive ? colors.black : colors.cream,
                                  fontWeight: isActive ? 700 : 500,
                                  transition: "background-color 0.15s ease, color 0.15s ease",
                                }}
                              >
                                {l.abbr}
                              </span>
                            )
                          }
                        </NavLink>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ flex: 1 }} />

            {user && (
              <div
                style={{
                  fontSize: 12,
                  color: colors.cream,
                  opacity: 0.85,
                  padding:
                    state === "expanded" ? "12px 14px 4px" : "12px 8px 4px",
                  borderTop: `1px solid color-mix(in srgb, ${colors.cream} 18%, transparent)`,
                  flexShrink: 0,
                }}
              >
                {state === "expanded" && (
                  <div style={{ overflow: "hidden", whiteSpace: "nowrap" }}>
                    <div style={{ fontWeight: 600 }}>{user.name}</div>
                    <div style={{ opacity: 0.75, marginBottom: 8 }}>
                      {user.role.replace(/_/g, " ")}
                    </div>
                  </div>
                )}
                <button
                  onClick={logout}
                  title="Log out"
                  tabIndex={collapsed ? -1 : undefined}
                  style={{
                    width: state === "expanded" ? "auto" : "100%",
                    fontSize: 12,
                    fontFamily: "inherit",
                    cursor: "pointer",
                    background: "transparent",
                    color: colors.gold,
                    border: `1px solid color-mix(in srgb, ${colors.gold} 55%, transparent)`,
                    borderRadius: 0,
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