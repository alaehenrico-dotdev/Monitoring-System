import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

interface NavLinkDef {
  to: string;
  label: string;
  roles: string[];
}

const ALL_ROLES = ["ONLINE_ENCODER", "OFFLINE_ENCODER", "SUPERVISOR_ADMIN"];

// Same groups + role filtering the sidebar drawer used to have. The group
// headings are gone (a ribbon has no room for them); groups are separated
// by a thin divider instead.
const groups: { heading: string; links: NavLinkDef[] }[] = [
  {
    heading: "Data Entry",
    links: [
      { to: "/dashboard", label: "Dashboard", roles: ["SUPERVISOR_ADMIN"] },
      { to: "/manual-count", label: "Audit", roles: ALL_ROLES },
      { to: "/online", label: "Online Entry", roles: ALL_ROLES },
      { to: "/offline", label: "Offline Entry", roles: ALL_ROLES },
      { to: "/total-stocks", label: "Total Stocks", roles: ALL_ROLES },
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
    ],
  },
  {
    heading: "Settings",
    links: [
      { to: "/settings", label: "Settings", roles: ["SUPERVISOR_ADMIN"] },
    ],
  },
];

/// Horizontal text-tab row at the top of the page header (PageHeader.tsx), like the
/// tab strip on MS Office apps (File / Home / Insert ...). Replaces the
/// link list that used to live in the floating sidebar drawer.
export function HeaderTabs() {
  const { user } = useAuth();

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      links: g.links.filter((l) => !user || l.roles.includes(user.role)),
    }))
    .filter((g) => g.links.length > 0);

  if (visibleGroups.length === 0) return null;

  return (
    <nav className="ae-header-tabs no-print" aria-label="Main navigation">
      {visibleGroups.map((group, i) => (
        <div key={group.heading} className="ae-header-tabs-group">
          {i > 0 && <span aria-hidden className="ae-header-tabs-divider" />}
          {group.links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              title={l.label}
              className="ae-header-tab"
              onClick={(e) => e.currentTarget.blur()}
            >
              <span className="ae-header-tab-label">{l.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
