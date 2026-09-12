import { useEffect, useState, type MouseEvent } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { LogoMark } from "./LogoMark";
import { ChevronDownIcon } from "./icons";
import { colors, fonts } from "../theme";

const links = [
  { to: "/online", label: "Online Entry", abbr: "ON", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
  { to: "/offline", label: "Offline Entry", abbr: "OF", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
  { to: "/total-stocks", label: "Total Stocks", abbr: "TS", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
  { to: "/manual-count", label: "Manual Count", abbr: "MC", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
  { to: "/receipts", label: "Receipts", abbr: "RC", roles: ["ONLINE_ENCODER", "SUPERVISOR_ADMIN"] },
  { to: "/variance-report", label: "Variance Report", abbr: "VR", roles: ["SUPERVISOR_ADMIN"] },
  { to: "/daily-report", label: "Daily Report", abbr: "DR", roles: ["SUPERVISOR_ADMIN"] },
  { to: "/change-log", label: "Change Log", abbr: "CL", roles: ["SUPERVISOR_ADMIN"] },
  { to: "/products", label: "Products", abbr: "PR", roles: ["SUPERVISOR_ADMIN"] },
];

const SIDEBAR_HIDDEN_KEY = "ae-sidebar-hidden";

function readInitialHidden(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Sidebar behavior (Section: nav rail):
 * - At rest it's always the slim icon rail (`.sidebar-rail`, 76px reserved
 *   in the flex layout) - not a "remembered" expanded/collapsed choice like
 *   before, just the permanent default. It stays this way regardless of
 *   what page is open - clicking a nav tab never expands or pins it; see
 *   the NavLink onClick below for why that's not just true by default.
 * - Hovering it (mouse, or Tab-focusing a link inside) pops the *inner*
 *   content out to the full 232px, full-label layout as a floating overlay
 *   (`.sidebar-inner` goes `position: absolute`, wider, elevated) - purely
 *   via CSS `:hover`/`:focus-within` in index.css, no React state. Because
 *   the rail's own reserved width never changes for this, main never
 *   reflows for a hover peek.
 * - Clicking the logo instead tucks the whole rail away entirely - width
 *   animates to 0 and its own logo fades out. In its place, a `.ghost-logo`
 *   (same 40px LogoMark) fades in floated at the top of `main`'s own
 *   content, so it reads as the same logo staying put while the rest
 *   disappears around it, rather than a new disconnected control
 *   appearing - see the .ghost-logo block below and its CSS for how that
 *   float also lets the page's own h2/p wrap beside it while the toolbar
 *   and grid below still expand to the full width. `fullyHidden` is the
 *   one piece of this that's real React state (and persisted), since it's
 *   an explicit, remembered choice rather than a transient hover.
 */
export function Layout() {
  const { user, logout } = useAuth();
  const [fullyHidden, setFullyHidden] = useState(readInitialHidden);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_HIDDEN_KEY, fullyHidden ? "1" : "0");
    } catch {
      // Ignore - still works for this session, just won't be remembered.
    }
  }, [fullyHidden]);

  // A clicked NavLink keeps keyboard focus afterward, which would satisfy
  // .sidebar-rail:focus-within (added so Tab users can peek the full rail)
  // and leave the rail looking stuck open post-navigation even after the
  // mouse has moved away. Blurring right after the click removes that
  // focus so the rail reverts to minimized like a plain hover would.
  function blurAfterClick(e: MouseEvent<HTMLElement>) {
    e.currentTarget.blur();
  }

  return (
    // Fixed to the viewport height (not minHeight) with overflow hidden, so
    // the nav and main below are two independently-scrolling panes instead
    // of one flex row that stretches to match whichever side is taller.
    <div className="app-shell" style={{ fontFamily: fonts.body, height: "100vh", display: "flex", overflow: "hidden" }}>
      <nav className={`no-print sidebar-rail ${fullyHidden ? "sidebar-rail--hidden" : ""}`}>
        <div className="sidebar-inner">
          <div
            className="sidebar-logo-row"
            onClick={() => setFullyHidden(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setFullyHidden(true);
              }
            }}
            role="button"
            tabIndex={0}
            title="Hide sidebar"
            aria-label="Hide sidebar"
          >
            <LogoMark size={40} />
            <div className="sidebar-logo-text">
              <h1 style={{ fontFamily: fonts.wordmark, fontSize: 16, fontWeight: 800, color: colors.yellow, margin: 0, lineHeight: 1.1 }}>
                Ala Eh!
              </h1>
              <p style={{ fontSize: 10.5, color: colors.cream, opacity: 0.75, margin: 0, letterSpacing: 0.3 }}>Stocks Monitoring</p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {links
              .filter((l) => !user || l.roles.includes(user.role))
              .map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className="sidebar-link"
                  onClick={blurAfterClick}
                  style={({ isActive }) => ({
                    color: isActive ? colors.black : colors.cream,
                    background: isActive ? colors.yellow : "transparent",
                    fontWeight: isActive ? 700 : 500,
                  })}
                >
                  <span className="sidebar-link-abbr">{l.abbr}</span>
                  <span className="sidebar-link-full">{l.label}</span>
                </NavLink>
              ))}
          </div>

          <div style={{ flex: 1 }} />

          {user && (
            // Border spans the full sidebar width (negative margin cancels
            // the inner's own side padding); the text/button inside is
            // padded back in by .sidebar-user-block's own CSS so its left
            // edge lines up with the link labels above.
            <div className="sidebar-user-block" style={{ margin: "0 -14px", borderTop: `1px solid ${colors.goldDark}` }}>
              <div className="sidebar-user-text">
                <div style={{ fontWeight: 600 }}>{user.name}</div>
                <div style={{ opacity: 0.75, marginBottom: 8 }}>{user.role.replace(/_/g, " ")}</div>
              </div>
              <button onClick={logout} title="Log out" className="sidebar-logout-btn">
                <span className="sidebar-link-abbr">⏻</span>
                <span className="sidebar-link-full">Log out</span>
              </button>
            </div>
          )}
        </div>
      </nav>

      <main className="ae-main" style={{ flex: 1, height: "100%", overflow: "auto", background: colors.paper, color: colors.ink }}>
        {fullyHidden && (
          <div
            className="ghost-logo"
            onClick={() => setFullyHidden(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setFullyHidden(false);
              }
            }}
            role="button"
            tabIndex={0}
            title="Show sidebar"
            aria-label="Show sidebar"
          >
            <LogoMark size={40} />
            <ChevronDownIcon />
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
