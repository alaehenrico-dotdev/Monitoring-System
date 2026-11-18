import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { phoneNavLabel, phoneNavPages } from "../config/navigation";
import {
  EllipsisVerticalIcon,
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

export type NavLayout = "split" | "centered";

/// A normal phone's width: one row of six, short labels, no layout choice.
const NARROW_QUERY = "(max-width: 599px)";
function subscribeNarrow(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const q = window.matchMedia(NARROW_QUERY);
  q.addEventListener("change", listener);
  return () => q.removeEventListener("change", listener);
}
const isNarrow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;

const LAYOUT_KEY = "ae:phone-nav-layout";

/// Split (two pills, one at each side) is the default; the choice is remembered on this device.
function readNavLayout(): NavLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "centered" ? "centered" : "split";
  } catch {
    return "split";
  }
}

function saveNavLayout(layout: NavLayout) {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    /* the choice just lasts until the page is reloaded */
  }
}

/// The phone's page navigation: floating pills along the bottom of the screen, under the thumb and
/// always in view, in place of the header's tab strip (HeaderTabs.tsx). It lists the phone's pages
/// for this role (config/navigation.ts), as an icon over its full page name. Two layouts: split (the default; the pages shared between a left and a
/// right pill) or one centred pill. A three-dots button at the end of the right-hand pill opens the
/// switch between them. Mounted by Layout.tsx on a phone only.
export function PhoneBottomNav() {
  const { user } = useAuth();
  const pages = phoneNavPages(user?.role);
  const compact = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const [layout, setLayout] = useState<NavLayout>(readNavLayout);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // The ring is exactly one DEVICE pixel thick, whatever the screen's density (1 / devicePixelRatio CSS
  // px): a fixed 0.5px is one device pixel only at 2x and blurs at 2.6x or 3x. Re-measured when the
  // density changes (moving the window to another screen, zooming).
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    let mq: MediaQueryList | undefined;
    const apply = () => {
      const dpr = window.devicePixelRatio || 1;
      el.style.setProperty("--ae-hair", `${1 / dpr}px`);
      if (typeof window.matchMedia !== "function") return;
      mq?.removeEventListener("change", apply);
      mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
      mq.addEventListener("change", apply, { once: true });
    };
    apply();
    return () => mq?.removeEventListener("change", apply);
  }, [compact, layout]);

  // Switching layouts: each page link glides from where it was to where it now is (a FLIP move),
  // and the pills ease in. The links are re-created under a different parent, so their old
  // positions are taken just before the switch and matched up by address.
  const navRef = useRef<HTMLElement>(null);
  const before = useRef<Map<string, DOMRect> | null>(null);
  useLayoutEffect(() => {
    const from = before.current;
    before.current = null;
    const nav = navRef.current;
    if (!from || !nav || typeof nav.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timing = { duration: 340, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };
    nav.querySelectorAll<HTMLElement>(".ae-bottomnav-item").forEach((el) => {
      const old = from.get(el.getAttribute("href") ?? "");
      if (!old) return;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], timing);
    });
    nav.querySelectorAll<HTMLElement>(".ae-bottomnav-bar").forEach((el) =>
      el.animate(
        [
          { opacity: 0, transform: "translateY(10px) scale(0.96)" },
          { opacity: 1, transform: "none" },
        ],
        { ...timing, duration: 300 },
      ),
    );
  }, [layout]);

  if (pages.length === 0) return null;

  const choose = (next: NavLayout) => {
    if (next !== layout && navRef.current) {
      const rects = new Map<string, DOMRect>();
      navRef.current.querySelectorAll<HTMLElement>(".ae-bottomnav-item").forEach((el) => {
        rects.set(el.getAttribute("href") ?? "", el.getBoundingClientRect());
      });
      before.current = rects;
    }
    setLayout(next);
    saveNavLayout(next);
    setMenuOpen(false);
  };

  const item = (l: (typeof pages)[number]) => (
    <NavLink key={l.to} to={l.to} className="ae-bottomnav-item" aria-label={l.label}>
      {ICONS[l.to]}
      <span className="ae-bottomnav-label">{compact ? phoneNavLabel(l) : l.label}</span>
    </NavLink>
  );

  const ring = (
    <span className="ae-ring" aria-hidden="true">
      <i />
    </span>
  );

  const more = (
    <div className="ae-bottomnav-more" ref={menuRef}>
      <button
        type="button"
        className="ae-bottomnav-dots"
        aria-label="Navigation layout"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <EllipsisVerticalIcon />
      </button>
      {menuOpen && (
        <div className="ae-bottomnav-menu" role="menu" aria-label="Navigation layout">
          {(["split", "centered"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={layout === l}
              className="ae-bottomnav-menu-item"
              onClick={() => choose(l)}
            >
              {l === "split" ? "Split (both sides)" : "Centered"}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // Split: the first half of the pages on the left, the rest (and the dots) on the right.
  const half = Math.ceil(pages.length / 2);

  if (compact) {
    return (
      <nav ref={navRef} className="ae-bottomnav no-print" data-layout="centered" data-compact="true" aria-label="Main navigation">
        <div className="ae-bottomnav-bar">
          {ring}
          {pages.map(item)}
        </div>
      </nav>
    );
  }

  return (
    <nav ref={navRef} className="ae-bottomnav no-print" data-layout={layout} aria-label="Main navigation">
      {layout === "split" ? (
        <>
          <div className="ae-bottomnav-bar">
            {ring}
            {pages.slice(0, half).map(item)}
          </div>
          <div className="ae-bottomnav-bar">
            {ring}
            {pages.slice(half).map(item)}
            {more}
          </div>
        </>
      ) : (
        <div className="ae-bottomnav-bar">
          {ring}
          {pages.map(item)}
          {more}
        </div>
      )}
    </nav>
  );
}
