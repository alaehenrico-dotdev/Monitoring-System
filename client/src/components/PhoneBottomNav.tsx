import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { phoneNavLabel, phoneNavPages } from "../config/navigation";
import {
  EllipsisVerticalIcon,
  NavCountIcon,
  NavDashboardIcon,
  NavLogIcon,
  NavOutIcon,
  NavReportIcon,
  NavSettingsIcon,
  NavStocksIcon,
} from "./icons";

const ICONS: Record<string, ReactNode> = {
  "/dashboard": <NavDashboardIcon />,
  "/audit-count": <NavCountIcon />,
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

  // Switching layouts: one pill and two pills are the same thing at different distances. Nothing is
  // scaled and nothing cross-fades (both smeared the text and doubled the glass), so every edge of every
  // pill is drawn the whole way through:
  //  - to split, the two new pills start side by side exactly over the old pill, with their facing
  //    corners square and their facing border hidden, so they read as the one pill; they
  //    glide apart while those corners round off and the border comes back;
  //  - to centered, the two old pills (kept as ghosts) glide together while their facing corners square
  //    off and the facing border goes; the real pill, hidden until then, takes over in the same
  //    instant they meet, its own border already in place.
  // Every tab keeps its exact place on the way. Transforms are whole pixels so the text stays crisp.
  // Skipped under reduced motion.
  const navRef = useRef<HTMLElement>(null);
  const glideRef = useRef<HTMLSpanElement>(null);
  const before = useRef<{ tabs: Map<string, DOMRect>; bars: HTMLElement[] } | null>(null);
  const ghosts = useRef<Set<HTMLElement>>(new Set());
  useEffect(() => {
    const live = ghosts.current;
    return () => {
      live.forEach((g) => g.remove());
      live.clear();
    };
  }, []);
  useLayoutEffect(() => {
    const from = before.current;
    before.current = null;
    const nav = navRef.current;
    if (!from || !nav) return;
    // To split: quick off the mark, soft landing. To centered: an even glide that ends decisively, so the
    // real pill can take over the moment the ghosts meet instead of after a slow tail.
    const toCentered = from.bars.length > 0;
    const MOVE = toCentered ? 340 : 420;
    const glide = toCentered ? "cubic-bezier(0.45, 0, 0.2, 1)" : "cubic-bezier(0.22, 1, 0.36, 1)";
    const px = (n: number) => `${Math.round(n)}px`;
    const href = (bar: Element) => bar.querySelector(".ae-bottomnav-item")?.getAttribute("href") ?? "";
    const tab = (h: string) => Array.from(nav.querySelectorAll<HTMLElement>(".ae-bottomnav-item")).find((el) => el.getAttribute("href") === h);
    const bars = Array.from(nav.querySelectorAll<HTMLElement>(".ae-bottomnav-bar"));

    // The facing side of a pill, as the one pill has it (square, no border) and as it is.
    const edge = (el: HTMLElement, i: number) => {
      const cs = getComputedStyle(el);
      const side = i === 0 ? "Right" : "Left"; // the left pill faces right, the right pill faces left
      const dash = side.toLowerCase();
      const full = {
        [`borderTop${side}Radius`]: cs.getPropertyValue(`border-top-${dash}-radius`),
        [`borderBottom${side}Radius`]: cs.getPropertyValue(`border-bottom-${dash}-radius`),
        [`border${side}Color`]: cs.getPropertyValue(`border-${dash}-color`),
      };
      const flat = { [`borderTop${side}Radius`]: "0px", [`borderBottom${side}Radius`]: "0px", [`border${side}Color`]: "transparent" };
      return { full, flat };
    };

    if (from.bars.length === 0) {
      // One pill becomes two.
      bars.forEach((bar, i) => {
        const first = tab(href(bar));
        const old = from.tabs.get(href(bar));
        if (!first || !old) return;
        const now = first.getBoundingClientRect();
        const { full, flat } = edge(bar, i);
        bar.animate([{ transform: `translate(${px(old.left - now.left)}, ${px(old.top - now.top)})`, ...flat }, { transform: "none", ...full }], { duration: MOVE, easing: glide });
      });
    } else {
      // Two pills become one.
      bars[0]?.animate([{ visibility: "hidden" }, { visibility: "hidden" }], { duration: MOVE });
      from.bars.forEach((ghost, i) => {
        const h = href(ghost);
        const target = tab(h);
        const old = from.tabs.get(h);
        const release = () => {
          ghost.remove();
          ghosts.current.delete(ghost);
        };
        if (!target || !old) return release();
        const now = target.getBoundingClientRect();
        const { flat } = edge(ghost, i);
        ghost.animate([{ transform: "none" }, { transform: `translate(${px(now.left - old.left)}, ${px(now.top - old.top)})`, ...flat }], { duration: MOVE, easing: glide, fill: "forwards" }).onfinish = release;
      });
    }
    // The open tab's line rides with its tab: from where that tab was to where it is, on the same curve
    // as the pills, so it is never hidden and never fades in late.
    const line = glideRef.current;
    const active = nav.querySelector<HTMLElement>('.ae-bottomnav-item[aria-current="page"]');
    const was = active && from.tabs.get(active.getAttribute("href") ?? "");
    if (line && active && was) {
      const now = active.getBoundingClientRect();
      line.animate([{ transform: `translate(${px(was.left - now.left)}, ${px(was.top - now.top)})`, offset: 0 }, { transform: "none", offset: 1 }], { duration: MOVE, easing: glide, composite: "add" });
    }
  }, [layout]);

  // The line over the open tab is one element for the whole bar that slides to the tab just chosen
  // (across both pills in the split layout), instead of each tab drawing its own. Placed from
  // offsetLeft/offsetTop, which a tab's own FLIP transform does not disturb. Only a page change glides;
  // a layout switch, a resize or the first paint put it in place at once.
  const { pathname } = useLocation();
  const lastPath = useRef<string | null>(null);
  const placeGlide = (animate: boolean) => {
    const nav = navRef.current;
    const line = glideRef.current;
    if (!nav || !line) return;
    const active = nav.querySelector<HTMLElement>(".ae-bottomnav-item[aria-current=\"page\"]");
    if (!active) {
      line.style.opacity = "0";
      return;
    }
    const bar = active.offsetParent as HTMLElement | null;
    if (!bar) return;
    const inset = active.offsetWidth * 0.28;
    const x = bar.offsetLeft + active.offsetLeft + inset;
    const y = bar.offsetTop + active.offsetTop - 1;
    line.style.transition = animate ? "" : "none";
    line.style.width = `${active.offsetWidth - inset * 2}px`;
    line.style.transform = `translate(${x}px, ${y}px)`;
    line.style.opacity = "1";
  };
  useLayoutEffect(() => {
    placeGlide(lastPath.current !== null && lastPath.current !== pathname);
    lastPath.current = pathname;
  }, [pathname, layout, compact, pages.length]);
  useEffect(() => {
    const onResize = () => placeGlide(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (pages.length === 0) return null;

  const choose = (next: NavLayout) => {
    const nav = navRef.current;
    const motionOk = typeof Element.prototype.animate === "function" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (next !== layout && nav && motionOk) {
      const tabs = new Map<string, DOMRect>();
      nav.querySelectorAll<HTMLElement>(".ae-bottomnav-item").forEach((el) => tabs.set(el.getAttribute("href") ?? "", el.getBoundingClientRect()));
      const bars: HTMLElement[] = [];
      // Only going to centered needs the old pills kept; to split, the new pills start over the old one.
      const old = next === "centered" ? Array.from(nav.querySelectorAll<HTMLElement>(".ae-bottomnav-bar")) : [];
      old.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const ghost = el.cloneNode(true) as HTMLElement;
        ghost.setAttribute("aria-hidden", "true");
        ghost.setAttribute("inert", "");
        ghost.querySelectorAll("a, button").forEach((n) => n.setAttribute("tabindex", "-1"));
        Object.assign(ghost.style, {
          position: "fixed",
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: "0",
          pointerEvents: "none",
          zIndex: "40",
          willChange: "transform",
        });
        document.body.appendChild(ghost);
        ghosts.current.add(ghost);
        bars.push(ghost);
      });
      before.current = { tabs, bars };
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
      <span ref={glideRef} className="ae-nav-glide" aria-hidden="true" />
        <div className="ae-bottomnav-bar">
          {pages.map(item)}
        </div>
      </nav>
    );
  }

  return (
    <nav ref={navRef} className="ae-bottomnav no-print" data-layout={layout} aria-label="Main navigation">
      <span ref={glideRef} className="ae-nav-glide" aria-hidden="true" />
      {layout === "split" ? (
        <>
          <div className="ae-bottomnav-bar">
              {pages.slice(0, half).map(item)}
          </div>
          <div className="ae-bottomnav-bar">
              {pages.slice(half).map(item)}
            {more}
          </div>
        </>
      ) : (
        <div className="ae-bottomnav-bar">
          {pages.map(item)}
          {more}
        </div>
      )}
    </nav>
  );
}
