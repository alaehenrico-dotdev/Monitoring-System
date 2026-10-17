import { useEffect, useLayoutEffect, useRef } from "react";
import { animate } from "motion/react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { navGroups } from "../config/navigation";

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
// Likewise the strip's sideways scroll (on a narrow window it overflows): a new
// instance starts where the last one was, so the tabs do not jump back to the
// left on every page change.
let lastScrollLeft = 0;

// The active-tab line slides to the new tab in one short ease-out: both edges
// move together, so it never stretches or lags behind.
const SLIDE = { duration: 0.2, ease: "easeOut" } as const;

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
    nav.scrollLeft = lastScrollLeft;
    const remember = () => {
      lastScrollLeft = nav.scrollLeft;
    };
    nav.addEventListener("scroll", remember, { passive: true });

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
      return () => nav.removeEventListener("scroll", remember);
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
      const cur = { ...from };
      const draw = () => place(cur.left, cur.right);
      draw();
      const leftAnim = animate(from.left, target.left, {
        ...SLIDE,
        onUpdate: (v) => {
          cur.left = v;
          draw();
        },
      });
      const rightAnim = animate(from.right, target.right, {
        ...SLIDE,
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
    // fonts loading) - re-snap the line unless it is mid-slide.
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
      nav.removeEventListener("scroll", remember);
    };
  }, [pathname, user?.role]);

  // The strip overflows sideways (scrollbar hidden), which a mouse wheel
  // cannot drive: it only scrolls vertically. While the pointer is over the
  // strip, turn the wheel into sideways scrolling - but only while there is
  // somewhere to go, so the page still scrolls normally at either end. The
  // listener is native and non-passive because preventDefault is needed.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    function onWheel(e: WheelEvent) {
      if (!nav || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = nav.scrollWidth - nav.clientWidth;
      if (max <= 0) return;
      const atStart = nav.scrollLeft <= 0 && e.deltaY < 0;
      const atEnd = nav.scrollLeft >= max - 1 && e.deltaY > 0;
      if (atStart || atEnd) return;
      e.preventDefault();
      nav.scrollLeft += e.deltaY;
    }
    nav.addEventListener("wheel", onWheel, { passive: false });
    return () => nav.removeEventListener("wheel", onWheel);
  }, [user?.role]);

  // Keep the active tab in view: with more tabs than fit, navigating (or
  // landing on a page directly) could leave its tab scrolled out of sight.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('.ae-header-tab[aria-current="page"]');
    if (!nav || !active) return;
    const target = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollTo({ left: Math.max(0, target), behavior: reduce ? "auto" : "smooth" });
  }, [pathname, user?.role]);

  const visibleGroups = navGroups
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
    </nav>
  );
}
