import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/// Short on purpose: a browser tab shows only ~12 characters, so the page name
/// goes first and the brand is a short tail that may be cut off.
const BRAND = "Ala Eh";

const PAGE_TITLES: Record<string, string> = {
  "/login": "Sign in",
  "/forgot-password": "Reset password",
  "/online": "Online Entry",
  "/offline": "Offline Entry",
  "/total-stocks": "Total Stocks",
  "/daily-out": "Daily Out",
  "/daily-out-history": "Daily Out History",
  "/manual-count": "Manual Count",
  "/audit-history": "Audit History",
  "/daily-report": "Daily Report",
  "/daily-report-history": "Report History",
  "/corrections": "Corrections",
  "/awaiting-release": "Awaiting Release",
  "/settings": "Settings",
  "/dashboard": "Dashboard",
  "/variance-report": "Variance",
  "/variance-report-history": "Variance History",
  "/variance-ledger": "Variance Ledger",
  "/admin-queue": "Admin Queue",
  "/change-log": "Change Log",
  "/products": "Products",
};

export function titleFor(pathname: string): string {
  const page = PAGE_TITLES[pathname.replace(/\/+$/, "") || "/"];
  return page ? `${page} · ${BRAND}` : `${BRAND} Stocks`;
}

/// Keeps the browser tab's title in step with the page the user is on.
export function useDocumentTitle(): void {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleFor(pathname);
  }, [pathname]);
}
