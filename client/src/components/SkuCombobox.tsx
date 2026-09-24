import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Product } from "../types";
import { matchesSearch } from "../utils/search";

const PANEL_MAX_HEIGHT = 260;

/**
 * Type-ahead SKU/product picker - replaces the plain `<select>` in the
 * receipt form's item rows. The box is a real text input: focus it and start
 * typing, and the list narrows live to products whose SKU, name or category
 * contain every typed word (same multi-term matching as the page searches,
 * see utils/search.ts - "gal toyo" finds "Toyomansi" in a gallon category).
 *
 * Keyboard: Up/Down move the highlight, Enter picks it, Esc closes, Tab
 * picks the highlighted match and moves on (so a fast encoder can type,
 * Tab, type the quantity). Clicking a suggestion also picks it.
 *
 * The list is portaled to <body> with fixed positioning (same approach as
 * Dropdown) because the receipt paper clips its bottom edge with a
 * clip-path and would cut off an in-place popup.
 */
export function SkuCombobox({
  products,
  value,
  onChange,
  style,
  "aria-label": ariaLabel = "SKU",
}: {
  products: Product[];
  /// Selected product id, 0 = none.
  value: number;
  onChange: (productId: number) => void;
  style?: CSSProperties;
  "aria-label"?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // What's typed while the box is focused; null = show the selected product.
  const [text, setText] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; above: boolean } | null>(null);

  const selected = products.find((p) => p.id === value) ?? null;
  const selectedLabel = selected ? `${selected.sku ? `${selected.sku} — ` : ""}${selected.name}` : "";

  const matches = useMemo(
    () => (text ? products.filter((p) => matchesSearch([p.sku, p.name, p.category], text)) : products),
    [products, text],
  );

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const above = window.innerHeight - r.bottom < PANEL_MAX_HEIGHT + 12 && r.top > window.innerHeight - r.bottom;
      setRect({ left: r.left, top: above ? r.top : r.bottom, width: r.width, above });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Keep the highlighted suggestion in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function close() {
    setOpen(false);
    setText(null);
  }

  function pick(product: Product) {
    onChange(product.id);
    close();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (open) {
        // Never let Enter submit the receipt form from inside the picker.
        e.preventDefault();
        const match = matches[activeIndex];
        if (match) pick(match);
      }
    } else if (e.key === "Tab") {
      // Only auto-pick when the person actually typed something to narrow by.
      const match = text ? matches[activeIndex] : undefined;
      if (open && match) onChange(match.id);
      close();
    } else if (e.key === "Escape") {
      if (open) {
        e.stopPropagation();
        close();
      }
    }
  }

  const listing =
    open && rect
      ? createPortal(
          <div
            className="ae-dropdown"
            role="listbox"
            style={{
              left: rect.left,
              width: Math.max(rect.width, 240),
              ...(rect.above ? { bottom: window.innerHeight - rect.top + 2 } : { top: rect.top + 2 }),
            }}
          >
            <div className="ae-dropdown-list" ref={listRef} style={{ maxHeight: PANEL_MAX_HEIGHT }}>
              {matches.length === 0 ? (
                <div style={{ padding: "8px 12px", opacity: 0.7 }}>No matching SKU</div>
              ) : (
                matches.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={p.id === value}
                    data-index={i}
                    className={`ae-dropdown-option${p.id === value ? " ae-dropdown-option--selected" : ""}`}
                    style={i === activeIndex && p.id !== value ? { background: "var(--ae-surface-hover)" } : undefined}
                    title={`${p.category} — ${p.name}`}
                    // mousedown (not click) so the input's blur doesn't close
                    // the list before the pick registers.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(p);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                  >
                    {p.sku ? `${p.sku} — ` : ""}
                    {p.name}
                    <span style={{ opacity: 0.6, marginLeft: 6, fontSize: 11 }}>{p.category}</span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <input
        ref={inputRef}
        className="ae-input"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search SKU or product…"
        value={text ?? selectedLabel}
        title={selectedLabel || undefined}
        onFocus={(e) => {
          setOpen(true);
          setText(null);
          // Start at the current selection so opening the list shows where you are.
          setActiveIndex(Math.max(0, products.findIndex((p) => p.id === value)));
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onBlur={close}
        onKeyDown={handleKeyDown}
        style={style}
      />
      {listing}
    </>
  );
}