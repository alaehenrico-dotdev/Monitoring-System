import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { listProducts } from "../api/products";
import {
  defaultGridPageFor,
  GRID_PAGES,
  navGroups,
  pagesForRole,
  type NavLinkDef,
} from "../config/navigation";
import { rankQuickJump, type QuickJumpResult } from "../utils/quickJump";
import { requestQuickJump } from "../utils/quickJumpTarget";
import type { Product } from "../types";

/**
 * Products for the palette, fetched at most once per session rather than per
 * keystroke (or even per open). The catalogue is a few hundred rows of
 * slow-moving reference data that every grid already loads anyway, so the
 * palette piggy-backs on one cached call instead of adding traffic to the
 * one interaction that has to feel instant.
 *
 * A failed load resolves to an empty list AND drops the cache, so the next
 * open retries rather than leaving the palette permanently product-less.
 */
let productsCache: Promise<Product[]> | null = null;

function loadProducts(): Promise<Product[]> {
  if (!productsCache) {
    productsCache = listProducts().catch(() => {
      productsCache = null;
      return [] as Product[];
    });
  }
  return productsCache;
}

/// Test/reset seam - also called after a Data Reset would invalidate the list.
export function clearQuickJumpProductCache(): void {
  productsCache = null;
}

/// Which ribbon group a page sits in, for the row's right-hand hint.
function groupOf(page: NavLinkDef): string {
  return (
    navGroups.find((g) => g.links.some((l) => l.to === page.to))?.heading ??
    "Page"
  );
}

const isGridPage = (path: string): boolean =>
  (GRID_PAGES as readonly string[]).includes(path);

/**
 * Ctrl+K / Cmd+K command palette - jump to any page the current role can
 * open, or to any product on a grid.
 *
 * Mounted once in Layout, so the shortcut works from every page. The
 * shortcut deliberately fires even while a grid cell input has focus: it
 * carries a modifier, so it can't collide with the digits an encoder is
 * typing, and having to click out of the sheet first would defeat the point
 * of a keyboard jump. (Plain keys are never bound here for exactly that
 * reason.)
 */
export function QuickJump() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Where focus was before the palette opened, so closing puts it back - the
  // grid cell someone jumped from should still be the grid cell they land
  // in if they change their mind and press Escape.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
    returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "k" || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setOpen((wasOpen) => {
        if (wasOpen) {
          returnFocusRef.current?.focus();
          return false;
        }
        returnFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        return true;
      });
      setQuery("");
      setActive(0);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Opened from the header's search button as well as the shortcut.
  useEffect(() => {
    function onOpen() {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setQuery("");
      setActive(0);
      setOpen(true);
    }
    window.addEventListener(QUICK_JUMP_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(QUICK_JUMP_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    let cancelled = false;
    loadProducts().then((list) => {
      if (!cancelled) setProducts(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const pages = useMemo(() => pagesForRole(user?.role), [user?.role]);

  // Filtering a few hundred rows is a sub-millisecond string scan, so there
  // is nothing here worth debouncing - a debounce would only add latency to
  // the keystroke it is meant to protect.
  const results = useMemo(
    () => rankQuickJump(query, pages, products, groupOf),
    [query, pages, products],
  );

  // A narrowing query can leave the cursor past the end of the list.
  const clampedActive = Math.min(active, Math.max(results.length - 1, 0));

  // Keeps the highlighted row in view while arrowing past the visible window.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-qj-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [clampedActive, open, results.length]);

  function choose(result: QuickJumpResult) {
    close();
    if (result.kind === "page") {
      navigate(result.to);
      return;
    }
    // A product lands on the grid the user was already working in, so
    // jumping doesn't silently move them between channels; otherwise their
    // role's own grid.
    const destination = isGridPage(pathname)
      ? pathname
      : defaultGridPageFor(user?.role);
    requestQuickJump(result.productId);
    if (destination !== pathname) navigate(destination);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    // Only the input is focusable inside the panel, so trapping focus is
    // just refusing to let Tab leave it.
    if (e.key === "Tab") {
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => {
        const from = Math.min(i, results.length - 1);
        return (from + step + results.length) % results.length;
      });
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : results.length - 1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[clampedActive];
      if (hit) choose(hit);
    }
  }

  if (!open) return null;

  const listId = "ae-quickjump-list";

  return createPortal(
    <div
      className="ae-quickjump-overlay no-print"
      onMouseDown={(e) => {
        if (!panelRef.current?.contains(e.target as Node)) close();
      }}
    >
      <div
        ref={panelRef}
        className="ae-quickjump"
        role="dialog"
        aria-modal="true"
        aria-label="Quick jump"
      >
        <input
          ref={inputRef}
          className="ae-quickjump-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            results[clampedActive]
              ? `ae-qj-${results[clampedActive].id}`
              : undefined
          }
          aria-label="Search pages and products"
          placeholder="Jump to a page or product…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Results"
          className="ae-quickjump-list"
        >
          {results.length === 0 ? (
            <div className="ae-quickjump-empty">No matching page or product</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                id={`ae-qj-${r.id}`}
                type="button"
                role="option"
                aria-selected={i === clampedActive}
                data-qj-active={i === clampedActive}
                className={`ae-quickjump-item${i === clampedActive ? " ae-quickjump-item--active" : ""}`}
                // Mouse down would close the palette via the overlay handler
                // before the click ever lands.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
              >
                <span className="ae-quickjump-item-label">{r.label}</span>
                <span className="ae-quickjump-item-hint">{r.hint}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/// Lets the header's search button open the palette without threading state
/// through every page's PageHeader - the palette is mounted once in Layout,
/// far from the button, and a context provider for one boolean would be more
/// machinery than this needs.
export const QUICK_JUMP_OPEN_EVENT = "ae:quick-jump-open";

export function openQuickJump(): void {
  window.dispatchEvent(new Event(QUICK_JUMP_OPEN_EVENT));
}
