import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { LogoMark } from "./LogoMark";
import { colors, fonts } from "../theme";

const links = [
  { to: "/online", label: "Online Entry", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
  { to: "/offline", label: "Offline Entry", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
  { to: "/total-stocks", label: "Total Stocks", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
  { to: "/manual-count", label: "Manual Count", roles: ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"] },
  { to: "/receipts", label: "Receipts", roles: ["ONLINE_ENCODER", "SUPERVISOR_ADMIN"] },
  { to: "/variance-report", label: "Variance Report", roles: ["SUPERVISOR_ADMIN"] },
  { to: "/daily-report", label: "Daily Report", roles: ["SUPERVISOR_ADMIN"] },
  { to: "/products", label: "Products", roles: ["SUPERVISOR_ADMIN"] },
];

export function Layout() {
  const { user, logout } = useAuth();

  return (
    // Fixed to the viewport height (not minHeight) with overflow hidden, so
    // the nav and main below are two independently-scrolling panes instead
    // of one flex row that stretches to match whichever side is taller. Long
    // sheets (Offline Entry) used to inflate this row's height, and since a
    // flex row stretches every child to match it, the sidebar got pulled
    // down to that same height, dragging the logout block far below the
    // fold. Each pane now scrolls on its own, so the sidebar is always
    // exactly one screen tall regardless of how long the active page is.
    <div style={{ fontFamily: fonts.body, height: "100vh", display: "flex", overflow: "hidden" }}>
      <nav
        className="no-print"
        style={{
          width: 232,
          flexShrink: 0,
          height: "100%",
          overflowY: "auto",
          background: colors.blackSoft,
          color: colors.cream,
          padding: "20px 14px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <LogoMark size={40} />
          <div>
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
                style={({ isActive }) => ({
                  padding: "8px 10px",
                  borderRadius: 6,
                  textDecoration: "none",
                  color: isActive ? colors.black : colors.cream,
                  background: isActive ? colors.gold : "transparent",
                  fontWeight: isActive ? 700 : 500,
                  fontSize: 13.5,
                  transition: "background 120ms ease",
                })}
              >
                {l.label}
              </NavLink>
            ))}
        </div>

        <div style={{ flex: 1 }} />

        {user && (
          // Border spans the full sidebar width (negative margin cancels the
          // nav's own side padding), but the text/button inside is padded
          // back in by the same 24px (14px nav padding + 10px link inset)
          // that the nav links above use, so this section's left edge lines
          // up with the link labels instead of sitting flush against the rail.
          <div
            style={{
              fontSize: 12,
              color: colors.cream,
              opacity: 0.85,
              margin: "0 -14px",
              padding: "12px 24px 4px",
              borderTop: `1px solid ${colors.goldDark}`,
            }}
          >
            <div style={{ fontWeight: 600 }}>{user.name}</div>
            <div style={{ opacity: 0.75, marginBottom: 8 }}>{user.role.replace(/_/g, " ")}</div>
            <button
              onClick={logout}
              style={{
                fontSize: 12,
                cursor: "pointer",
                background: "transparent",
                color: colors.gold,
                border: `1px solid ${colors.goldDark}`,
                borderRadius: 5,
                padding: "4px 10px",
              }}
            >
              Log out
            </button>
          </div>
        )}
      </nav>

      <main style={{ flex: 1, height: "100%", overflow: "auto", padding: 24, background: colors.paper, color: colors.ink }}>
        <Outlet />
      </main>
    </div>
  );
}
