import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useReadOnlyPhone } from "../hooks/useReadOnlyPhone";
import { useAiAvailable } from "../hooks/useAiAvailable";
import { askData } from "../api/ai";
import { SparklesIcon } from "./icons";
import { questionFirst, sourcesLine } from "../utils/aiSources";
import { AI_PLACEHOLDER, aiFallback } from "../utils/aiFallback";
import { listProducts, PRODUCTS_CHANGED_EVENT } from "../api/products";
import { getTotalStocks } from "../api/totalStocks";
import {
  defaultGridPageFor,
  GRID_PAGES,
  navGroups,
  pagesForRole,
  phoneNavPages,
  type NavLinkDef,
} from "../config/navigation";
import { settingsTabsFor } from "../config/settingsTabs";
import { rankPhoneSearch, type PhoneSearchResult } from "../utils/phoneSearch";
import { rankQuickJump, type QuickJumpResult } from "../utils/quickJump";
import { requestQuickJump } from "../utils/quickJumpTarget";
import { handOff } from "../utils/searchHandoff";
import { getCurrentShiftAndDate } from "../utils/shift";
import type { Product, TotalStockRow } from "../types";

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

/// Exported for the cache test (components/QuickJump.cache.test.tsx).
export function loadProducts(): Promise<Product[]> {
  if (!productsCache) {
    productsCache = listProducts().catch(() => {
      productsCache = null;
      return [] as Product[];
    });
  }
  return productsCache;
}

/// Drops the cached list so the next open refetches. Runs whenever the product list
/// changes (api/products.ts announces it) and after a Data Reset.
export function clearQuickJumpProductCache(): void {
  productsCache = null;
}

if (typeof window !== "undefined") {
  window.addEventListener(PRODUCTS_CHANGED_EVENT, clearQuickJumpProductCache);
}

/// Today's remaining stock by product, for the figures under a product on the phone's search.
/// Asked for when the search opens and kept for a minute, so opening it again (or typing) costs
/// nothing. A failed load is not kept: the results simply come without figures.
const STOCKS_TTL_MS = 60_000;
let stocksCache: { date: string; at: number; rows: Promise<ReadonlyMap<number, TotalStockRow> | null> } | null = null;

function loadStocks(date: string): Promise<ReadonlyMap<number, TotalStockRow> | null> {
  if (stocksCache && stocksCache.date === date && Date.now() - stocksCache.at < STOCKS_TTL_MS) return stocksCache.rows;
  const rows = getTotalStocks(date).then(
    (list) => new Map(list.map((r) => [r.product.id, r])),
    () => {
      stocksCache = null;
      return null;
    },
  );
  stocksCache = { date, at: Date.now(), rows };
  return rows;
}

/// A result of either search: the desktop launcher's (pages and products) or the phone's.
/// The "Ask AI" row (Supervisor/Admin, server has a key). Choosing it asks the question in place.
interface AiResult {
  kind: "ai";
  id: string;
  label: string;
  hint: string;
}
type Result = QuickJumpResult | PhoneSearchResult | AiResult;

/// The AI answer shown inside the palette instead of the result list.
type AiState = { question: string } & (
  | { status: "loading" }
  | { status: "done"; answer: string; sources: { tool: string; args: Record<string, unknown> }[] }
  | { status: "error"; text: string; detail?: string; retry: boolean }
);

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
 * On a phone the same panel (opened from the header's magnifier) is the search
 * for the whole read-only system - pages, settings sections, products with
 * today's stock, categories, dates and the Change Log - ranked by
 * utils/phoneSearch.ts and shown in groups. The desktop palette is unchanged.
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
  const [stocks, setStocks] = useState<ReadonlyMap<number, TotalStockRow> | null>(null);
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isPhone = useReadOnlyPhone();
  // AI: the "Ask AI" row, and the answer that replaces the list once it is asked. aiReq numbers each
  // question so a late answer to one the person has since edited away is dropped.
  const aiOn = useAiAvailable();
  const [ai, setAi] = useState<AiState | null>(null);
  const aiReq = useRef(0);
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
    aiReq.current++;
    setAi(null);
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
      aiReq.current++;
      setAi(null);
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
      aiReq.current++;
      setAi(null);
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
    // Phone only: the stock figures shown under each product.
    if (isPhone) {
      loadStocks(getCurrentShiftAndDate().date).then((map) => {
        if (!cancelled) setStocks(map);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [open, isPhone]);

  const phone = isPhone;
  const pages = useMemo(
    () => (phone ? phoneNavPages(user?.role) : pagesForRole(user?.role, false)),
    [user?.role, phone],
  );
  const settings = useMemo(() => settingsTabsFor(user?.role === "SUPERVISOR_ADMIN"), [user?.role]);

  // Filtering a few hundred rows is a sub-millisecond string scan, so there
  // is nothing here worth debouncing - a debounce would only add latency to
  // the keystroke it is meant to protect.
  const results = useMemo<Result[]>(() => {
    const base: Result[] = phone
      ? rankPhoneSearch(query, { pages, groupOf, settings, products, stocks, today: getCurrentShiftAndDate().date, theme })
      : rankQuickJump(query, pages, products, groupOf);
    const q = query.trim();
    if (!aiOn || q.length < 3) return base;
    const row: AiResult = { kind: "ai", id: "ai-ask", label: `Ask AI: ${q}`, hint: "AI" };
    // A question goes first (Enter asks it); anything else goes last, so Enter still jumps to the
    // best page or product exactly as it always did.
    return questionFirst(q) ? [row, ...base] : [...base, row];
  }, [phone, query, pages, settings, products, stocks, theme, aiOn]);

  // A narrowing query can leave the cursor past the end of the list.
  const clampedActive = Math.min(active, Math.max(results.length - 1, 0));

  // Keeps the highlighted row in view while arrowing past the visible window.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-qj-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [clampedActive, open, results.length]);

  function askAi(question: string) {
    const text = question.trim();
    if (!aiOn || text.length < 3) return;
    const id = ++aiReq.current;
    setAi({ question: text, status: "loading" });
    askData(text).then(
      (r) => {
        if (id === aiReq.current) setAi({ question: text, status: "done", answer: r.answer, sources: r.sources });
      },
      (e: unknown) => {
        if (id === aiReq.current) setAi({ question: text, status: "error", ...aiFallback(e, AI_PLACEHOLDER.search) });
      },
    );
  }

  function choose(result: Result) {
    // Asking keeps the palette open: the answer appears in it.
    if (result.kind === "ai") {
      askAi(query);
      return;
    }
    close();
    if (result.kind === "action") {
      toggleTheme();
      return;
    }
    if (result.kind === "link") {
      // The value goes first, so the page finds it whether it is about to mount or already open.
      if (result.handoff) handOff(result.handoff.key, result.handoff.value);
      if (result.to !== pathname) navigate(result.to);
      return;
    }
    if (result.kind === "page") {
      navigate(result.to);
      return;
    }
    // A product lands on the grid the user was already working in, so
    // jumping doesn't silently move them between channels; otherwise their
    // role's own grid.
    const destination = isGridPage(pathname)
      ? pathname
      : defaultGridPageFor(user?.role, phone);
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
      // Ctrl/Cmd+Enter asks the AI whatever was typed; plain Enter leaves a shown answer alone.
      if (e.ctrlKey || e.metaKey) {
        askAi(query);
        return;
      }
      if (ai) return;
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
        className={`ae-quickjump${phone ? " ae-quickjump--phone" : ""}${aiOn ? " ae-quickjump--ai" : ""}${aiOn && ai?.status === "loading" ? " ae-quickjump--thinking" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={phone ? "Search" : "Quick jump"}
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
          aria-label={phone ? "Search the whole system" : "Search pages and products"}
          placeholder={
            phone
              ? aiOn
                ? "Search, or ask a question…"
                : "Product, SKU, page, date, setting…"
              : aiOn
                ? "Jump to a page or product, or ask a question…"
                : "Jump to a page or product…"
          }
          // Phone keyboards: no capital first letter or "corrections" of a SKU, and a Search key.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={phone ? "search" : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            // Editing the text goes back to searching.
            aiReq.current++;
            setAi(null);
          }}
          onKeyDown={onKeyDown}
        />
        {ai ? (
          <div className="ae-quickjump-ai" role="status" aria-live="polite">
            <div className="ae-quickjump-ai-q">{ai.question}</div>
            {ai.status === "loading" && <div className="ae-quickjump-ai-a ae-quickjump-ai-thinking">Thinking…</div>}
            {/* Not an error as far as the person is concerned: a calm note, and the search still works. */}
            {ai.status === "error" && (
              <div className="ae-quickjump-ai-a ae-quickjump-ai-soft">
                {ai.text}
                {ai.detail && <div className="ae-quickjump-ai-note">{ai.detail}</div>}
                {ai.retry && (
                  <button
                    type="button"
                    className="ae-quickjump-ai-retry"
                    // Keeps focus in the input, so Escape still closes the palette.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => askAi(ai.question)}
                  >
                    Try again
                  </button>
                )}
              </div>
            )}
            {ai.status === "done" && (
              <>
                <div className="ae-quickjump-ai-a">{ai.answer}</div>
                {ai.sources.length > 0 && <div className="ae-quickjump-ai-src">Based on {sourcesLine(ai.sources)}</div>}
                <div className="ae-quickjump-ai-note">AI-written from your figures - check the numbers. Edit the text to search again.</div>
              </>
            )}
          </div>
        ) : (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Results"
          className="ae-quickjump-list"
        >
          {results.length === 0 ? (
            <div className="ae-quickjump-empty">
              {phone ? "Nothing matches. Try a product, SKU, category, a date (Nov 9) or a setting." : "No matching page or product"}
            </div>
          ) : (
            results.map((r, i) => (
              <Fragment key={r.id}>
              {/* Phone: a heading where each group of results starts. */}
              {"group" in r && (i === 0 || !("group" in results[i - 1]) || (results[i - 1] as PhoneSearchResult).group !== r.group) && query.trim() !== "" && (
                <div className="ae-quickjump-group" role="presentation">
                  {r.group}
                </div>
              )}
              <button
                id={`ae-qj-${r.id}`}
                type="button"
                role="option"
                aria-selected={i === clampedActive}
                data-qj-active={i === clampedActive}
                className={`ae-quickjump-item${i === clampedActive ? " ae-quickjump-item--active" : ""}${r.kind === "ai" ? " ae-quickjump-item--ai" : ""}`}
                // Mouse down would close the palette via the overlay handler
                // before the click ever lands.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
              >
                <span className="ae-quickjump-item-label">
                  {r.kind === "ai" && (
                    <span className="ae-quickjump-ai-icon">
                      <SparklesIcon />
                    </span>
                  )}
                  {r.label}
                  {"detail" in r && r.detail && <span className="ae-quickjump-item-detail">{r.detail}</span>}
                </span>
                <span className="ae-quickjump-item-hint">{r.hint}</span>
              </button>
              </Fragment>
            ))
          )}
        </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/// Lets the header's search button open the palette without threading state
/// through every page's PageHeader - the palette is mounted once in Layout,
/// far from the button, and a context provider for one boolean would be more
/// machinery than this needs.
const QUICK_JUMP_OPEN_EVENT = "ae:quick-jump-open";

export function openQuickJump(): void {
  window.dispatchEvent(new Event(QUICK_JUMP_OPEN_EVENT));
}
