import { useLayoutEffect, useRef } from "react";
import { animate } from "motion/react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ServerSettingsLink } from "./ServerSettings";

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

// Horizontal extent (px from the strip's left edge) of the gold underline.
// Kept at module level because every page renders its own HeaderTabs (inside
// PageHeader), so the strip remounts on each navigation - remembering where
// the line last was lets the new instance start there and stretch to the new
// tab instead of just appearing under it.
interface Edges {
  left: number;
  right: number;
}
let lastEdges: Edges | null = null;

// Windows 11 taskbar-style indicator: the line is two independent edges on
// critically damped springs (damping = 2 * sqrt(stiffness), so no overshoot
// or bounce). The edge heading toward the new tab leads slightly and the
// trailing edge follows a beat later, giving a soft, brief stretch while it
// glides to the new tab and settles cleanly.
const LEAD_SPRING = { stiffness: 600, damping: 49 };
const TRAIL_SPRING = { stiffness: 380, damping: 39 };

// Matches the 10px side padding of .ae-header-tab: the line spans the label.
const TAB_INSET = 10;

/// Horizontal text-tab row at the top of the page header (PageHeader.tsx), like the
/// tab strip on MS Office apps (File / Home / Insert ...). Replaces the
/// link list that used to live in the floating sidebar drawer.
export function HeaderTabs() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const animatingRef = useRef(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const bar = barRef.current;
    if (!nav || !bar) return;

    const place = (left: number, right: number) => {
      bar.style.transform = `translateX(${left}px)`;
      bar.style.width = `${Math.max(right - left, 0)}px`;
      lastEdges = { left, right };
    };

    // offsetLeft/offsetWidth (not getBoundingClientRect) so the result stays
    // in the strip's own coordinates under the app's CSS zoom control.
    const measure = (): (Edges & { top: number }) | null => {
      const active = nav.querySelector<HTMLElement>(
        '.ae-header-tab[aria-current="page"]',
      );
      if (!active) return null;
      const left = active.offsetLeft + TAB_INSET;
      return {
        left,
        right: active.offsetLeft + active.offsetWidth - TAB_INSET,
        top: active.offsetTop + active.offsetHeight - 4,
      };
    };

    const target = measure();
    if (!target) {
      bar.style.opacity = "0";
      lastEdges = null;
      return;
    }
    bar.style.opacity = "1";
    bar.style.top = `${target.top}px`;

    let stop: (() => void) | undefined;
    let cancelled = false;
    const from = lastEdges;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (
      !from ||
      reduce ||
      (from.left === target.left && from.right === target.right)
    ) {
      place(target.left, target.right);
    } else {
      animatingRef.current = true;
      const movingRight = target.left > from.left;
      const cur = { ...from };
      const draw = () => place(cur.left, cur.right);
      draw();
      const leftAnim = animate(from.left, target.left, {
        type: "spring",
        ...(movingRight ? TRAIL_SPRING : LEAD_SPRING),
        onUpdate: (v) => {
          cur.left = v;
          draw();
        },
      });
      const rightAnim = animate(from.right, target.right, {
        type: "spring",
        ...(movingRight ? LEAD_SPRING : TRAIL_SPRING),
        onUpdate: (v) => {
          cur.right = v;
          draw();
        },
      });
      Promise.all([leftAnim, rightAnim]).then(
        () => {
          if (cancelled) return;
          animatingRef.current = false;
          place(target.left, target.right);
        },
        () => {},
      );
      stop = () => {
        leftAnim.stop();
        rightAnim.stop();
        animatingRef.current = false;
      };
    }

    // Tabs can shift without a navigation (window resize, zoom control,
    // fonts loading) - re-snap the line unless it is mid-spring.
    const ro = new ResizeObserver(() => {
      if (animatingRef.current) return;
      const t = measure();
      if (t) {
        bar.style.top = `${t.top}px`;
        place(t.left, t.right);
      }
    });
    ro.observe(nav);
    return () => {
      cancelled = true;
      ro.disconnect();
      stop?.();
    };
  }, [pathname, user?.role]);

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      links: g.links.filter((l) => !user || l.roles.includes(user.role)),
    }))
    .filter((g) => g.links.length > 0);

  if (visibleGroups.length === 0) return null;

  return (
    <nav
      ref={navRef}
      className="ae-header-tabs no-print"
      aria-label="Main navigation"
    >
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
      <span ref={barRef} aria-hidden className="ae-header-tabs-bar" />
      <div className="ae-header-tabs-settings">
        <ServerSettingsLink />
      </div>
    </nav>
  );
}
