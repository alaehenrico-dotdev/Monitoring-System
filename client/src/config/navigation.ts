import type { Role } from "../types";

export interface NavLinkDef {
  to: string;
  label: string;
  roles: Role[];
}

export interface NavGroup {
  heading: string;
  links: NavLinkDef[];
}

const ALL_ROLES: Role[] = ["ENCODER", "SUPERVISOR_ADMIN"];

/**
 * Single source of truth for the app's page list and who may open each one -
 * previously inlined in HeaderTabs.tsx, which was fine while the tab strip
 * was the only thing that navigated. The quick-jump palette (Ctrl+K) needs
 * exactly the same list filtered exactly the same way, and two copies of a
 * role table is precisely the kind of thing that drifts: a page added to the
 * ribbon but not the palette would simply be unreachable by search, and
 * worse, a page whose roles were tightened in one list and not the other
 * would keep being *offered* to someone the router then bounces.
 *
 * These `roles` mirror the <ProtectedRoute allow={...}> guards in App.tsx.
 * They decide what is *shown*; the router and the server remain the things
 * that actually enforce access.
 */
export const navGroups: NavGroup[] = [
  {
    heading: "Data Entry",
    links: [
      { to: "/dashboard", label: "Dashboard", roles: ["SUPERVISOR_ADMIN"] },
      { to: "/manual-count", label: "Audit", roles: ALL_ROLES },
      { to: "/online", label: "Online Entry", roles: ALL_ROLES },
      { to: "/offline", label: "Offline Entry", roles: ALL_ROLES },
      { to: "/awaiting-release", label: "Awaiting Release", roles: ALL_ROLES },
      { to: "/total-stocks", label: "Consolidated", roles: ALL_ROLES },
      { to: "/daily-out", label: "Daily Out", roles: ALL_ROLES },
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
        to: "/variance-ledger",
        label: "Variance Ledger",
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
    // What needs a second pair of eyes: requested corrections (any role may
    // ask), the admin's queue of open items, and the trail of what changed.
    heading: "Review",
    links: [
      { to: "/corrections", label: "Corrections", roles: ALL_ROLES },
      { to: "/admin-queue", label: "Admin Queue", roles: ["SUPERVISOR_ADMIN"] },
      { to: "/change-log", label: "Change Log", roles: ["SUPERVISOR_ADMIN"] },
    ],
  },
  {
    heading: "System",
    links: [
      { to: "/products", label: "SKUs", roles: ["SUPERVISOR_ADMIN"] },
      { to: "/settings", label: "Settings", roles: ALL_ROLES },
    ],
  },
];

/// The pages one role may open, flattened out of their ribbon groups. A
/// missing/not-yet-loaded user gets everything, matching HeaderTabs' own
/// `!user ||` behavior - the router still guards each route, so an
/// unauthenticated render can't actually reach any of them.
export function pagesForRole(role: Role | undefined, phone = false): NavLinkDef[] {
  return navGroups.flatMap((g) =>
    g.links.filter((l) => (!role || l.roles.includes(role)) && (!phone || isPhonePage(l.to))),
  );
}

/// The only pages a phone shows (hooks/useReadOnlyPhone.ts): the ones that just
/// read. Everything else - entry grids, audits, approvals, admin - needs the
/// desktop layout (a phone browser's "Desktop site" option gets it).
export const PHONE_PAGES = ["/dashboard", "/daily-report", "/total-stocks", "/daily-out", "/change-log", "/settings"] as const;

export function isPhonePage(path: string): boolean {
  return PHONE_PAGES.some((p) => path === p || path.startsWith(p + "/"));
}

/// Where a phone lands: the Dashboard for an admin (the only role allowed it),
/// the Daily Report for everyone else.
export function phoneHomeFor(role: Role | undefined): string {
  return role === "SUPERVISOR_ADMIN" ? "/dashboard" : "/daily-report";
}

/// The entry grids, which are the only pages a product result can sensibly
/// jump *to* - the palette lands a product on whichever of these the user
/// was last on (see utils/quickJump.ts).
export const GRID_PAGES = ["/online", "/offline", "/total-stocks"] as const;

/// Where a product result goes when the user isn't already on a grid page.
export function defaultGridPageFor(_role: Role | undefined, phone = false): string {
  return phone ? "/total-stocks" : "/online";
}
