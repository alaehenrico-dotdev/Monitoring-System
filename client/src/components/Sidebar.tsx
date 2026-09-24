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
import { PinIcon, ChevronIcon } from "./icons";
import { colors, fonts } from "../theme";
import { sidebarSpring } from "../motion";

// Below this width the sidebar drops its hover-driven rail/expanded states
// entirely and behaves as a single icon-only button that opens a dropdown
// menu on tap - hover has no reliable equivalent on touch, so trying to
// reuse the desktop rail there just leaves the menu stuck either fully
// closed or fully (256px) open with no useful middle state.
const MOBILE_BREAKPOINT = 768;
const MOBILE_MENU_QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`;

function readInitialIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_MENU_QUERY).matches;
}

const RAIL_WIDTH = 56;
const EXPANDED_WIDTH = 256;
const ICON_SIZE = 40;
const LOGO_SPIN_MS = 1100;
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
      {
        to: "/dashboard",
        label: "Dashboard",
        abbr: "DB",
        roles: ["SUPERVISOR_ADMIN"],
      },
      {
        to: "/online",
        label: "Online Entry",
        abbr: "ON",
        roles: [
          "ONLINE_ENCODER",
          "OFFLINE_ENCODER",
          "SUPERVISOR_ADMIN",
        ],
      },
      {
        to: "/offline",
        label: "Offline Entry",
        abbr: "OF",
        roles: [
          "ONLINE_ENCODER",
          "OFFLINE_ENCODER",
          "SUPERVISOR_ADMIN",
        ],
      },
      {
        to: "/manual-count",
        label: "Manual Count",
        abbr: "MC",
        roles: [
          "ONLINE_ENCODER",
          "OFFLINE_ENCODER",
          "SUPERVISOR_ADMIN",
        ],
      },
      {
        to: "/total-stocks",
        label: "Total Stocks",
        abbr: "TS",
        roles: [
          "ONLINE_ENCODER",
          "OFFLINE_ENCODER",
          "SUPERVISOR_ADMIN",
        ],
      },
      {
        to: "/receipts",
        label: "Receipts",
        abbr: "RC",
        roles: [
          "ONLINE_ENCODER",
          "OFFLINE_ENCODER",
          "SUPERVISOR_ADMIN",
        ],
      },
    ],
  },
  {
    heading: "Reports",
    links: [
      {
        to: "/consolidated-receipts",
        label: "Consolidated Receipt",
        abbr: "CR",
        roles: [
          "ONLINE_ENCODER",
          "OFFLINE_ENCODER",
          "SUPERVISOR_ADMIN",
        ],
      },
      {
        to: "/variance-report",
        label: "Variance Report",
        abbr: "VR",
        roles: ["SUPERVISOR_ADMIN"],
      },
      {
        to: "/daily-report",
        label: "Daily Report",
        abbr: "DR",
        roles: ["SUPERVISOR_ADMIN"],
      },
    ],
  },
  {
    heading: "Admin",
    links: [
      {
        to: "/change-log",
        label: "Change Log",
        abbr: "CL",
        roles: ["SUPERVISOR_ADMIN"],
      },
      {
        to: "/products",
        label: "SKUs",
        abbr: "SK",
        roles: ["SUPERVISOR_ADMIN"],
      },
      {
        to: "/delivery-destinations",
        label: "Delivery Destinations",
        abbr: "DD",
        roles: ["SUPERVISOR_ADMIN"],
      },
    ],
  },
  {
    heading: "Settings",
    links: [
      {
        to: "/settings",
        label: "Settings",
        abbr: "ST",
        roles: ["SUPERVISOR_ADMIN"],
      },
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

const NAV_STYLE = `
  .ae-sidebar-nav {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .ae-sidebar-nav::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  .ae-sidebar-tab:hover:not([aria-current="page"]) {
    background: color-mix(
      in srgb,
      ${colors.yellow} 16%,
      transparent
    ) !important;

    color: ${colors.yellow} !important;
  }

  .ae-sidebar-tab:hover:not([aria-current="page"])
    .ae-sidebar-tab-badge {
    background: color-mix(
      in srgb,
      ${colors.yellow} 22%,
      transparent
    );

    color: ${colors.yellow};
  }

  .ae-sidebar-logo .ae-logo-mark {
    display: block;
    flex-shrink: 0;
    overflow: visible;

    transition:
      transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1),
      filter 0.25s ease;
  }

  .ae-sidebar-logo:hover .ae-logo-mark,
  .ae-sidebar-logo:focus-visible .ae-logo-mark {
    transform: scale(1.06);

    filter: drop-shadow(
      0 0 6px
      color-mix(in srgb, ${colors.gold} 60%, transparent)
    );
  }

  .ae-sidebar-logo:active .ae-logo-mark {
    transform: scale(0.93);
  }

  @keyframes ae-sidebar-gradient-position {
    0%,
    100% {
      background-position: 0% 50%;
    }

    50% {
      background-position: 100% 50%;
    }
  }

  .ae-sidebar-gradient-sweep {
    animation:
      ae-sidebar-gradient-position
      13s linear infinite;
  }

  .ae-sidebar-tab-spotlight {
    opacity: var(--spotlight-opacity, 0);
    transition: opacity 220ms ease;
  }

  @keyframes ae-sidebar-mobile-arrow-glow {
    0%,
    100% {
      opacity: 0.55;
      filter: drop-shadow(
        0 0 0px ${colors.yellow}
      );
    }

    50% {
      opacity: 1;
      filter: drop-shadow(
        0 0 6px ${colors.yellow}
      );
    }
  }

  .ae-sidebar-mobile-arrow {
    animation:
      ae-sidebar-mobile-arrow-glow
      1.8s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .ae-sidebar-mobile-arrow {
      animation: none;
      opacity: 0.9;
    }
  }
`;

export function Sidebar() {
  const { user, logout } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);

  const [collapsed, setCollapsed] = useState(
    readInitialCollapsed,
  );

  const [pinned, setPinned] = useState(
    readInitialPinned,
  );

  const [isMouseOver, setIsMouseOver] =
    useState(false);

  const [isFocusWithin, setIsFocusWithin] =
    useState(false);

  const [isMobile, setIsMobile] = useState(
    readInitialIsMobile,
  );

  const [mobileOpen, setMobileOpen] =
    useState(false);

  const [logoSpin, setLogoSpin] = useState(0);

  const lastSpinAtRef = useRef(0);

  const [viewportHeight, setViewportHeight] =
    useState(() =>
      typeof window !== "undefined"
        ? window.innerHeight
        : 900,
    );

  useEffect(() => {
    try {
      localStorage.setItem(
        SIDEBAR_COLLAPSED_KEY,
        collapsed ? "1" : "0",
      );
    } catch {
      // Ignore storage errors.
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SIDEBAR_PINNED_KEY,
        pinned ? "1" : "0",
      );
    } catch {
      // Ignore storage errors.
    }
  }, [pinned]);

  useEffect(() => {
    if (
      document.getElementById(
        NAV_STYLE_TAG_ID,
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id = NAV_STYLE_TAG_ID;
    style.textContent = NAV_STYLE;

    document.head.appendChild(style);
  }, []);

  useEffect(() => {
    const mql = window.matchMedia(
      MOBILE_MENU_QUERY,
    );

    function onChange(
      e: MediaQueryListEvent,
    ) {
      setIsMobile(e.matches);

      if (!e.matches) {
        setMobileOpen(false);
      }
    }

    mql.addEventListener(
      "change",
      onChange,
    );

    return () =>
      mql.removeEventListener(
        "change",
        onChange,
      );
  }, []);

  useEffect(() => {
    const iconOnly = isMobile
      ? !mobileOpen
      : collapsed;

    document.body.classList.toggle(
      "ae-sidebar-collapsed-icon",
      iconOnly,
    );

    return () =>
      document.body.classList.remove(
        "ae-sidebar-collapsed-icon",
      );
  }, [
    collapsed,
    isMobile,
    mobileOpen,
  ]);

  useEffect(() => {
    let frame = 0;

    function onResize() {
      cancelAnimationFrame(frame);

      frame = requestAnimationFrame(
        () =>
          setViewportHeight(
            window.innerHeight,
          ),
      );
    }

    window.addEventListener(
      "resize",
      onResize,
    );

    return () => {
      window.removeEventListener(
        "resize",
        onResize,
      );

      cancelAnimationFrame(frame);
    };
  }, []);

  const hovered =
    !collapsed &&
    (isMouseOver ||
      isFocusWithin ||
      pinned);

  const state:
    | "rail"
    | "expanded"
    | "collapsed" = isMobile
    ? mobileOpen
      ? "expanded"
      : "collapsed"
    : collapsed
      ? "collapsed"
      : hovered
        ? "expanded"
        : "rail";

  function handleBlur(
    e: FocusEvent<HTMLDivElement>,
  ) {
    if (
      !containerRef.current?.contains(
        e.relatedTarget as Node | null,
      )
    ) {
      setIsFocusWithin(false);
    }
  }

  function blurAfterClick(
    e: MouseEvent<HTMLElement>,
  ) {
    e.currentTarget.blur();
  }

  function handleTabPointerMove(
    e: MouseEvent<HTMLAnchorElement>,
  ) {
    const el = e.currentTarget;
    const rect =
      el.getBoundingClientRect();

    if (
      rect.width === 0 ||
      rect.height === 0
    ) {
      return;
    }

    const x =
      ((e.clientX - rect.left) /
        rect.width) *
      100;

    const y =
      ((e.clientY - rect.top) /
        rect.height) *
      100;

    el.style.setProperty(
      "--mx",
      `${x}%`,
    );

    el.style.setProperty(
      "--my",
      `${y}%`,
    );

    el.style.setProperty(
      "--spotlight-opacity",
      "1",
    );
  }

  function handleTabPointerLeave(
    e: MouseEvent<HTMLAnchorElement>,
  ) {
    e.currentTarget.style.setProperty(
      "--spotlight-opacity",
      "0",
    );
  }

  function toggleCollapsed() {
    if (isMobile) {
      setMobileOpen(
        (prev) => !prev,
      );
      return;
    }

    setCollapsed(
      (prev) => !prev,
    );
  }

  function closeMobileMenu() {
    if (isMobile) {
      setMobileOpen(false);
    }
  }

  function togglePinned() {
    setPinned(
      (prev) => !prev,
    );
  }

  const width =
    state === "collapsed"
      ? ICON_SIZE
      : state === "expanded"
        ? EXPANDED_WIDTH
        : RAIL_WIDTH;

  const height =
    state === "collapsed"
      ? ICON_SIZE
      : viewportHeight;

  const inset =
    state === "collapsed"
      ? ICON_INSET
      : 0;

  const borderRadius =
    state === "collapsed"
      ? "70px 70px 70px 70px"
      : state === "expanded"
        ? "0px 0px 0px 0px"
        : "0px 0px 0px 0px";

  const spacerWidth =
    state === "collapsed"
      ? 0
      : width;

  return (
    <>
      {isMobile &&
        mobileOpen && (
          <div
            className="no-print"
            onClick={() =>
              setMobileOpen(false)
            }
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 49,
              background:
                "rgba(20, 17, 13, 0.35)",
            }}
          />
        )}

      <motion.div
        className="no-print"
        aria-hidden
        animate={{
          width: spacerWidth,
        }}
        transition={sidebarSpring}
        style={{
          flexShrink: 0,
          height: "100%",
        }}
      />

      <motion.div
        ref={containerRef}
        className="no-print"
        onMouseEnter={() =>
          setIsMouseOver(true)
        }
        onMouseLeave={() =>
          setIsMouseOver(false)
        }
        onFocus={() =>
          setIsFocusWithin(true)
        }
        onBlur={handleBlur}
        animate={{
          width,
          height,
          x: inset,
          y: inset,
          borderRadius,
        }}
        transition={sidebarSpring}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 50,
          overflow: "hidden",

          background: `color-mix(
            in srgb,
            ${colors.black} 82%,
            transparent
          )`,

          backdropFilter:
            "blur(20px) saturate(120%)",

          WebkitBackdropFilter:
            "blur(20px) saturate(120%)",

          /*
           * Expanded:
           * transparent base border because the animated
           * gradient overlay creates the visible border.
           *
           * Rail/collapsed:
           * no border. The minimized icon instead uses
           * a soft yellow glow through boxShadow.
           */
          border:
            state === "expanded"
              ? "0.5px solid transparent"
              : "none",

          color: colors.cream,

          boxShadow:
            state === "collapsed"
              ? `
                  0 8px 24px rgba(0, 0, 0, 0.55),
                  0 0 14px rgba(255, 212, 0, 0.28),
                  0 0 28px rgba(255, 212, 0, 0.12)
                `
              : "0 8px 32px rgba(0,0,0,0.4)",
        }}
      >
        {state === "expanded" && (
          <div
            aria-hidden
            className="ae-sidebar-gradient-sweep"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "inherit",
              padding: 0.5,
              pointerEvents: "none",

              backgroundImage: `linear-gradient(
                115deg,
                ${colors.black},
                ${colors.yellow},
                ${colors.black},
                ${colors.gold},
                ${colors.black},
                ${colors.cream},
                ${colors.black},
                ${colors.gold},
                ${colors.black},
                ${colors.yellow},
                ${colors.black}
              )`,

              backgroundSize:
                "400% 400%",

              WebkitMask:
                "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",

              WebkitMaskComposite:
                "xor",

              maskComposite:
                "exclude",
            }}
          />
        )}

        <div
          style={{
            padding:
              state === "collapsed"
                ? 0
                : "20px 0",

            height: "100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            className="ae-sidebar-logo"
            onMouseEnter={() => {
              const now =
                performance.now();

              if (
                now -
                  lastSpinAtRef.current <
                LOGO_SPIN_MS
              ) {
                return;
              }

              lastSpinAtRef.current =
                now;

              setLogoSpin(
                (n) => n + 1,
              );
            }}
            onClick={(e) => {
              toggleCollapsed();
              blurAfterClick(e);
            }}
            onKeyDown={(e) => {
              if (
                e.target !==
                e.currentTarget
              ) {
                return;
              }

              if (
                e.key === "Enter" ||
                e.key === " "
              ) {
                e.preventDefault();
                toggleCollapsed();
              }
            }}
            role="button"
            tabIndex={0}
            title={
              collapsed
                ? "Expand sidebar"
                : "Collapse sidebar into icon"
            }
            aria-label={
              collapsed
                ? "Expand sidebar"
                : "Collapse sidebar into icon"
            }
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent:
                "flex-start",
              gap:
                state === "expanded"
                  ? 10
                  : 0,

              width:
                state === "collapsed"
                  ? ICON_SIZE
                  : "100%",

              boxSizing:
                "border-box",

              paddingLeft:
                state === "collapsed"
                  ? 0
                  : state === "expanded"
                    ? 14
                    : 8,

              paddingRight:
                state === "collapsed"
                  ? 0
                  : state === "expanded"
                    ? 14
                    : 8,

              height:
                state === "collapsed"
                  ? ICON_SIZE
                  : "auto",

              marginBottom:
                state === "collapsed"
                  ? 0
                  : 20,

              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <LogoMark
              size={ICON_SIZE}
              spin={logoSpin}
            />

            {state ===
              "expanded" && (
              <div
                style={{
                  overflow: "hidden",
                  whiteSpace:
                    "nowrap",
                }}
              >
                <h1
                  style={{
                    fontFamily:
                      fonts.wordmark,
                    fontSize: 16,
                    fontWeight: 800,
                    color:
                      colors.yellow,
                    margin: 0,
                    lineHeight: 1.1,
                  }}
                >
                  Ala Eh!
                </h1>

                <p
                  style={{
                    fontSize: 10.5,
                    color:
                      colors.cream,
                    opacity: 0.75,
                    margin: 0,
                    letterSpacing: 0.3,
                  }}
                >
                  Stocks Monitoring
                </p>
              </div>
            )}

            {state ===
              "expanded" &&
              !isMobile && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePinned();
                    blurAfterClick(e);
                  }}
                  title={
                    pinned
                      ? "Unpin sidebar"
                      : "Pin sidebar open"
                  }
                  aria-label={
                    pinned
                      ? "Unpin sidebar"
                      : "Pin sidebar open"
                  }
                  aria-pressed={pinned}
                  className="ae-tap-target"
                  style={{
                    marginLeft: "auto",
                    flexShrink: 0,
                    width: 26,
                    height: 26,
                    display: "flex",
                    alignItems: "center",
                    justifyContent:
                      "center",
                    borderRadius:
                      "50%",
                    border: "none",
                    background:
                      pinned
                        ? colors.yellow
                        : "transparent",
                    color:
                      pinned
                        ? colors.black
                        : colors.cream,
                    cursor:
                      "pointer",
                    fontFamily:
                      "inherit",
                    transition:
                      "background-color 0.15s ease, color 0.15s ease",
                  }}
                >
                  <PinIcon
                    filled={pinned}
                  />
                </button>
              )}
          </div>

          <motion.div
            animate={{
              opacity:
                collapsed ? 0 : 1,
              scale:
                collapsed ? 0.6 : 1,
              y:
                collapsed ? -20 : 0,
            }}
            transition={sidebarSpring}
            style={{
              pointerEvents:
                collapsed
                  ? "none"
                  : "auto",

              flex: 1,
              display: "flex",
              flexDirection:
                "column",
              overflow: "hidden",
            }}
          >
            <div
              className="ae-sidebar-nav"
              style={{
                display: "flex",
                flexDirection:
                  "column",
                gap: 14,
                overflowY:
                  "auto",
                overflowX:
                  "hidden",
              }}
            >
              {sections.map(
                (section) => {
                  const visible =
                    section.links.filter(
                      (l) =>
                        !user ||
                        l.roles.includes(
                          user.role,
                        ),
                    );

                  if (
                    visible.length ===
                    0
                  ) {
                    return null;
                  }

                  return (
                    <div
                      key={
                        section.heading
                      }
                    >
                      {state ===
                        "expanded" && (
                        <p
                          style={{
                            margin:
                              "0 0 4px",
                            padding:
                              "0 14px",
                            fontSize:
                              10.5,
                            fontWeight:
                              700,
                            letterSpacing:
                              0.6,
                            textTransform:
                              "uppercase",
                            color:
                              colors.gold,
                            opacity:
                              0.8,
                          }}
                        >
                          {
                            section.heading
                          }
                        </p>
                      )}

                      <div
                        style={{
                          display:
                            "flex",
                          flexDirection:
                            "column",
                        }}
                      >
                        {visible.map(
                          (l) => (
                            <NavLink
                              key={
                                l.to
                              }
                              to={
                                l.to
                              }
                              title={
                                l.label
                              }
                              tabIndex={
                                collapsed
                                  ? -1
                                  : undefined
                              }
                              onClick={(
                                e,
                              ) => {
                                blurAfterClick(
                                  e,
                                );
                                closeMobileMenu();
                              }}
                              onMouseMove={
                                handleTabPointerMove
                              }
                              onMouseLeave={
                                handleTabPointerLeave
                              }
                              className="ae-sidebar-tab"
                              style={({
                                isActive,
                              }) => ({
                                position:
                                  "relative",

                                display:
                                  "flex",

                                alignItems:
                                  "center",

                                justifyContent:
                                  state ===
                                  "expanded"
                                    ? "flex-start"
                                    : "center",

                                width:
                                  "100%",

                                boxSizing:
                                  "border-box",

                                margin: 0,

                                padding:
                                  state ===
                                  "expanded"
                                    ? "10px 14px"
                                    : "6px 0",

                                borderRadius:
                                  0,

                                textDecoration:
                                  "none",

                                color:
                                  state ===
                                  "expanded"
                                    ? isActive
                                      ? colors.black
                                      : colors.cream
                                    : colors.cream,

                                background:
                                  state ===
                                  "expanded"
                                    ? isActive
                                      ? colors.yellow
                                      : "transparent"
                                    : "transparent",

                                fontWeight:
                                  state ===
                                  "expanded"
                                    ? isActive
                                      ? 700
                                      : 500
                                    : 500,

                                fontSize:
                                  13.5,

                                fontFamily:
                                  "inherit",

                                whiteSpace:
                                  "nowrap",

                                transition:
                                  "background-color 0.15s ease, color 0.15s ease",
                              })}
                            >
                              {({
                                isActive,
                              }: {
                                isActive: boolean;
                              }) => (
                                <>
                                  <div
                                    aria-hidden
                                    className="ae-sidebar-tab-spotlight"
                                    style={{
                                      position:
                                        "absolute",
                                      inset: 0,
                                      pointerEvents:
                                        "none",
                                      mixBlendMode:
                                        "screen",
                                      background:
                                        "radial-gradient(circle 90px at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.3), rgba(255,255,255,0.06) 55%, transparent 75%)",
                                    }}
                                  />

                                  {state ===
                                  "expanded" ? (
                                    l.label
                                  ) : (
                                    <span
                                      className="ae-sidebar-tab-badge"
                                      style={{
                                        display:
                                          "flex",

                                        alignItems:
                                          "center",

                                        justifyContent:
                                          "center",

                                        width:
                                          TAB_BADGE_SIZE,

                                        height:
                                          TAB_BADGE_SIZE,

                                        borderRadius:
                                          "50%",

                                        background:
                                          isActive
                                            ? colors.yellow
                                            : "transparent",

                                        color:
                                          isActive
                                            ? colors.black
                                            : colors.cream,

                                        fontWeight:
                                          isActive
                                            ? 700
                                            : 500,

                                        transition:
                                          "background-color 0.15s ease, color 0.15s ease",
                                      }}
                                    >
                                      {
                                        l.abbr
                                      }
                                    </span>
                                  )}
                                </>
                              )}
                            </NavLink>
                          ),
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>

            <div
              style={{
                flex: 1,
              }}
            />

            {user && (
              <div
                style={{
                  fontSize: 12,
                  color:
                    colors.cream,
                  opacity: 0.85,

                  padding:
                    state ===
                    "expanded"
                      ? "12px 14px 4px"
                      : "12px 8px 4px",

                  borderTop:
                    `1px solid color-mix(in srgb, ${colors.cream} 18%, transparent)`,

                  flexShrink: 0,
                }}
              >
                {state ===
                  "expanded" && (
                  <div
                    style={{
                      overflow:
                        "hidden",
                      whiteSpace:
                        "nowrap",
                    }}
                  >
                    <div
                      style={{
                        fontWeight:
                          600,
                      }}
                    >
                      {user.name}
                    </div>

                    <div
                      style={{
                        opacity:
                          0.75,
                        marginBottom:
                          8,
                      }}
                    >
                      {user.role.replace(
                        /_/g,
                        " ",
                      )}
                    </div>
                  </div>
                )}

                <button
                  onClick={logout}
                  title="Log out"
                  tabIndex={
                    collapsed
                      ? -1
                      : undefined
                  }
                  style={{
                    width:
                      state ===
                      "expanded"
                        ? "auto"
                        : "100%",

                    fontSize: 12,
                    fontFamily:
                      "inherit",
                    cursor:
                      "pointer",

                    background:
                      "transparent",

                    color:
                      colors.gold,

                    border:
                      `1px solid color-mix(in srgb, ${colors.gold} 55%, transparent)`,

                    borderRadius: 0,

                    padding:
                      state ===
                      "expanded"
                        ? "4px 10px"
                        : "4px 0",
                  }}
                >
                  {state ===
                  "expanded"
                    ? "Log out"
                    : "⏻"}
                </button>
              </div>
            )}
          </motion.div>
        </div>
      </motion.div>

      {isMobile &&
        state ===
          "collapsed" && (
          <button
            type="button"
            className="no-print ae-sidebar-mobile-arrow"
            onClick={() =>
              setMobileOpen(true)
            }
            title="Open menu"
            aria-label="Open menu"
            style={{
              position: "fixed",
              top:
                ICON_INSET +
                ICON_SIZE +
                4,

              left:
                ICON_INSET +
                ICON_SIZE / 2 -
                11,

              zIndex: 50,

              width: 22,
              height: 22,
              padding: 0,

              display: "flex",
              alignItems:
                "center",
              justifyContent:
                "center",

              borderRadius:
                "50%",

              border: "none",

              background:
                "transparent",

              color:
                colors.yellow,

              cursor:
                "pointer",
            }}
          >
            <ChevronIcon />
          </button>
        )}
    </>
  );
}