/**
 * App-wide cursor-follow spotlight for surfaces that don't have their own
 * handlers (dialogs, dropdowns, the date picker, the nav drawer, header tabs,
 * category bars, table headers, plain cards).
 *
 * One passive `pointermove` listener for the whole document, throttled to one
 * pass per animation frame. For every element under the pointer that matches
 * SPOT_SELECTOR (and every matching ancestor, so a button inside a dialog
 * lights up both) it writes `--spot-x` / `--spot-y` (percentages of that
 * element's box, so it is correct under the app's zoom control) and
 * `--spot-o` (opacity 1) straight onto the DOM - no React state, no
 * re-renders. Elements the pointer has left get `--spot-o: 0`. The glow
 * itself is the `::before` rule in index.css.
 */
const SPOT_SELECTOR = [
  ".ae-spot",
  ".ae-modal-panel",
  ".ae-datepicker",
  ".ae-dropdown",
  ".ae-header-tab",
  ".ae-cat-toggle",
  ".ae-table th",
].join(",");

// Enough for a header tab inside the page header inside a card inside a dialog.
const MAX_DEPTH = 6;

let installed = false;

export function installSpotlight(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;

  let active = new Set<HTMLElement>();
  let last: PointerEvent | null = null;
  let raf = 0;

  const clearAll = () => {
    last = null;
    for (const el of active) el.style.setProperty("--spot-o", "0");
    active = new Set();
  };

  const frame = () => {
    raf = 0;
    const e = last;
    if (!e) return;
    const next = new Set<HTMLElement>();
    let el =
      (e.target instanceof Element
        ? (e.target.closest(SPOT_SELECTOR) as HTMLElement | null)
        : null) ?? null;
    for (let depth = 0; el && depth < MAX_DEPTH; depth++) {
      next.add(el);
      el = (el.parentElement?.closest(SPOT_SELECTOR) as HTMLElement | null) ?? null;
    }
    for (const host of next) {
      const rect = host.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      host.style.setProperty(
        "--spot-x",
        `${((e.clientX - rect.left) / rect.width) * 100}%`,
      );
      host.style.setProperty(
        "--spot-y",
        `${((e.clientY - rect.top) / rect.height) * 100}%`,
      );
      host.style.setProperty("--spot-o", "1");
    }
    for (const host of active) {
      if (!next.has(host)) host.style.setProperty("--spot-o", "0");
    }
    active = next;
  };

  document.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") return;
      last = e;
      if (!raf) raf = requestAnimationFrame(frame);
    },
    { passive: true },
  );
  document.documentElement.addEventListener("pointerleave", clearAll);
  window.addEventListener("blur", clearAll);
}