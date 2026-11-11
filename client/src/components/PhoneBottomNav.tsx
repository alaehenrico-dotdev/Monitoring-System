import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { phoneNavLabel, phoneNavPages } from "../config/navigation";
import {
  NavDashboardIcon,
  NavLogIcon,
  NavOutIcon,
  NavReportIcon,
  NavSettingsIcon,
  NavStocksIcon,
} from "./icons";

const ICONS: Record<string, ReactNode> = {
  "/dashboard": <NavDashboardIcon />,
  "/daily-report": <NavReportIcon />,
  "/total-stocks": <NavStocksIcon />,
  "/daily-out": <NavOutIcon />,
  "/change-log": <NavLogIcon />,
  "/settings": <NavSettingsIcon />,
};

/// The phone's page navigation: a bar along the bottom of the screen, under the thumb and always
/// in view, in place of the header's tab strip (HeaderTabs.tsx), which sits at the top and scrolls
/// away with the page. It lists the phone's pages for this role (config/navigation.ts), as an
/// icon over a short label; the full page name is the link's accessible name. Mounted by
/// Layout.tsx on a phone only, as the last row of the app shell, so the page scrolls above it.
export function PhoneBottomNav() {
  const { user } = useAuth();
  const pages = phoneNavPages(user?.role);
  if (pages.length === 0) return null;

  return (
    <nav className="ae-bottomnav no-print" aria-label="Main navigation">
      {pages.map((l) => (
        <NavLink key={l.to} to={l.to} className="ae-bottomnav-item" aria-label={l.label}>
          {ICONS[l.to]}
          <span className="ae-bottomnav-label">{phoneNavLabel(l)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
